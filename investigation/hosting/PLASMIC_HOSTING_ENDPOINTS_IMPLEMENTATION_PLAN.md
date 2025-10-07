# Plasmic Custom Hosting Endpoints Implementation Plan

## Overview

This document outlines a plan to implement the missing hosting-related HTTP endpoints in Plasmic using the existing database layer and validation logic.

## Existing Components We Can Use

### 1. Database Layer (`DbMgr.ts`)
```typescript
// Already implemented:
- getDomainsForProject(projectId): Returns domains from key-value store
- setDomainForProject(projectId, domain): Stores domain in key-value store
- getPairsForProject(projectId): Gets key-value pairs for a project
```

### 2. Domain Validation (`hosting.ts`)
```typescript
// DomainValidator class provides:
- parseDomain(): Parse and validate domain format
- getApexDomain(): Extract apex domain
- isSubdomain(): Check if it's a subdomain
```

### 3. Configuration (`devflags.ts`)
```typescript
// Available settings:
- plasmicHostingSubdomainSuffix: ".plasmic.run" (configurable)
- enablePlasmicHosting: Feature flag
```

## Implementation Plan

### Step 1: Create Hosting Routes File

Create `platform/wab/src/wab/server/routes/hosting.ts`:

```typescript
import { Request, Response } from "express";
import { DbMgr } from "../db/DbMgr";
import { userDbMgr, hasUser } from "../app-auth";
import { DomainValidator } from "../../shared/hosting";
import { getDevFlagValue } from "../db/DevFlagStore";
import { 
  CheckDomainResponse,
  DomainsResponse,
  SetSubdomainResponse,
  SetCustomDomainResponse,
  PlasmicHostingSettings
} from "../../shared/ApiSchema";

// Constants for key-value storage
const HOSTING_SUBDOMAIN_KEY = "hosting.subdomain";
const HOSTING_CUSTOM_DOMAINS_KEY = "hosting.customDomains";
const HOSTING_SETTINGS_KEY = "hosting.settings";

// Helper to get subdomain suffix
async function getSubdomainSuffix(mgr: DbMgr): Promise<string> {
  return await getDevFlagValue(mgr, "plasmicHostingSubdomainSuffix") || ".plasmic.run";
}
```

### Step 2: Implement Domain Checking Endpoint

```typescript
// GET /api/v1/check-domain
export async function checkDomain(req: Request, res: Response) {
  const { domain } = req.query as { domain: string };
  
  if (!domain) {
    return res.status(400).json({ error: "Domain parameter required" });
  }

  const mgr = userDbMgr(req);
  const validator = new DomainValidator();
  
  try {
    // Validate domain format
    const parsedDomain = validator.parseDomain(domain);
    if (!parsedDomain) {
      return res.json({
        status: {
          isValid: false,
          isCorrectlyConfigured: false
        }
      } satisfies CheckDomainResponse);
    }

    // Check if domain is already used
    const projectsUsingDomain = await mgr.getProjectsUsingDomain(domain);
    const configuredBy = projectsUsingDomain.length > 0 
      ? `project:${projectsUsingDomain[0].id}`
      : undefined;

    // In real implementation, check DNS records here
    // For now, simulate configuration check
    const isCorrectlyConfigured = await checkDnsConfiguration(domain);

    return res.json({
      status: {
        isValid: true,
        isCorrectlyConfigured,
        configuredBy
      }
    } satisfies CheckDomainResponse);
  } catch (error) {
    console.error("Domain check error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// DNS checking (implement based on your infrastructure)
async function checkDnsConfiguration(domain: string): Promise<boolean> {
  // TODO: Implement actual DNS checking
  // - For subdomains: Check CNAME points to your infrastructure
  // - For apex domains: Check A records point to your IPs
  // For now, return false to simulate unconfigured
  return false;
}
```

### Step 3: Implement Domain Configuration Endpoints

```typescript
// GET /api/v1/domains-for-project/:projectId
export async function getDomainsForProject(req: Request, res: Response) {
  const { projectId } = req.params;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId, "viewer", "get domains");
    
    const domains = await mgr.getDomainsForProject(projectId);
    return res.json({ domains } satisfies DomainsResponse);
  } catch (error) {
    console.error("Get domains error:", error);
    return res.status(500).json({ error: "Failed to get domains" });
  }
}

// PUT /api/v1/subdomain-for-project
export async function setSubdomainForProject(req: Request, res: Response) {
  const { subdomain, projectId } = req.body;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId, "editor", "set subdomain");
    
    if (subdomain) {
      // Validate subdomain format
      const subdomainSuffix = await getSubdomainSuffix(mgr);
      const expectedSuffix = subdomain.endsWith(subdomainSuffix);
      
      if (!expectedSuffix) {
        return res.json({
          status: "DomainInvalid"
        } satisfies SetSubdomainResponse);
      }

      // Check if subdomain is already used
      const existingProjects = await mgr.getProjectsUsingDomain(subdomain);
      if (existingProjects.length > 0 && existingProjects[0].id !== projectId) {
        return res.json({
          status: "DomainUsedElsewhereInPlasmic"
        } satisfies SetSubdomainResponse);
      }
    }

    // Store subdomain
    await mgr.setProjectPair(projectId, HOSTING_SUBDOMAIN_KEY, subdomain || null);

    // Trigger deployment queue if subdomain was set
    if (subdomain) {
      await queueDeployment(projectId, "subdomain-update");
    }

    return res.json({
      status: "DomainUpdated"
    } satisfies SetSubdomainResponse);
  } catch (error) {
    console.error("Set subdomain error:", error);
    return res.status(500).json({ error: "Failed to set subdomain" });
  }
}

// PUT /api/v1/custom-domain-for-project
export async function setCustomDomainForProject(req: Request, res: Response) {
  const { customDomain, projectId } = req.body;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId, "editor", "set custom domain");
    
    // Get current custom domains
    const currentDomainsStr = await mgr.getProjectPair(projectId, HOSTING_CUSTOM_DOMAINS_KEY);
    const currentDomains: string[] = currentDomainsStr ? JSON.parse(currentDomainsStr) : [];
    
    let status: Record<string, string> = {};

    if (customDomain) {
      // Validate domain
      const validator = new DomainValidator();
      const parsed = validator.parseDomain(customDomain);
      
      if (!parsed) {
        status[customDomain] = "DomainInvalid";
        return res.json({ status } satisfies SetCustomDomainResponse);
      }

      // Check if already used elsewhere
      const existingProjects = await mgr.getProjectsUsingDomain(customDomain);
      if (existingProjects.length > 0 && existingProjects[0].id !== projectId) {
        status[customDomain] = "DomainUsedElsewhereInPlasmic";
        return res.json({ status } satisfies SetCustomDomainResponse);
      }

      // Add to domains list
      if (!currentDomains.includes(customDomain)) {
        currentDomains.push(customDomain);
      }

      // Handle www subdomain automatically
      const wwwDomain = `www.${parsed.apexDomain}`;
      if (customDomain === parsed.apexDomain && !currentDomains.includes(wwwDomain)) {
        currentDomains.push(wwwDomain);
        status[wwwDomain] = "DomainUpdated";
      }

      status[customDomain] = "DomainUpdated";
    } else {
      // Remove all custom domains if customDomain is null/undefined
      currentDomains.length = 0;
    }

    // Store updated domains
    await mgr.setProjectPair(
      projectId, 
      HOSTING_CUSTOM_DOMAINS_KEY, 
      currentDomains.length > 0 ? JSON.stringify(currentDomains) : null
    );

    // Queue deployment
    if (currentDomains.length > 0) {
      await queueDeployment(projectId, "custom-domain-update");
    }

    return res.json({ status } satisfies SetCustomDomainResponse);
  } catch (error) {
    console.error("Set custom domain error:", error);
    return res.status(500).json({ error: "Failed to set custom domain" });
  }
}
```

### Step 4: Implement Hosting Settings Endpoints

```typescript
// GET /api/v1/plasmic-hosting/:projectId
export async function getPlasmicHostingSettings(req: Request, res: Response) {
  const { projectId } = req.params;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId, "viewer", "get hosting settings");
    
    const settingsStr = await mgr.getProjectPair(projectId, HOSTING_SETTINGS_KEY);
    const settings = settingsStr ? JSON.parse(settingsStr) : {};
    
    return res.json(settings satisfies PlasmicHostingSettings);
  } catch (error) {
    console.error("Get hosting settings error:", error);
    return res.status(500).json({ error: "Failed to get hosting settings" });
  }
}

// PUT /api/v1/plasmic-hosting/:projectId  
export async function updatePlasmicHostingSettings(req: Request, res: Response) {
  const { projectId } = req.params;
  const settings = req.body as PlasmicHostingSettings;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId, "editor", "update hosting settings");
    
    // Validate settings
    if (settings.favicon && !isValidUrl(settings.favicon.url)) {
      return res.status(400).json({ error: "Invalid favicon URL" });
    }

    // Store settings
    await mgr.setProjectPair(projectId, HOSTING_SETTINGS_KEY, JSON.stringify(settings));
    
    // Queue redeployment to update favicon
    await queueDeployment(projectId, "settings-update");
    
    return res.json({ success: true });
  } catch (error) {
    console.error("Update hosting settings error:", error);
    return res.status(500).json({ error: "Failed to update hosting settings" });
  }
}
```

### Step 5: Implement Deployment Trigger

```typescript
// POST /api/v1/revalidate-hosting
export async function revalidateHosting(req: Request, res: Response) {
  const { projectId } = req.body;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId, "editor", "trigger deployment");
    
    // Get latest published version
    const latestVersion = await mgr.getLatestPublishedPkgVersion(projectId);
    if (!latestVersion) {
      return res.status(400).json({ error: "No published version found" });
    }

    // Queue deployment job
    const deploymentId = await queueDeployment(projectId, "manual-trigger", {
      version: latestVersion.version,
      triggeredBy: req.user!.id
    });

    return res.json({
      success: true,
      deploymentId,
      message: "Deployment queued"
    });
  } catch (error) {
    console.error("Revalidate hosting error:", error);
    return res.status(500).json({ error: "Failed to trigger deployment" });
  }
}

// Helper function to queue deployments
async function queueDeployment(
  projectId: string, 
  trigger: string,
  metadata?: Record<string, any>
): Promise<string> {
  // TODO: Implement your deployment queue
  // This could use Bull, RabbitMQ, AWS SQS, etc.
  const deploymentId = generateUuid();
  
  // For now, just log
  console.log("Queuing deployment:", {
    deploymentId,
    projectId,
    trigger,
    metadata,
    timestamp: new Date().toISOString()
  });
  
  return deploymentId;
}
```

### Step 6: Register Routes

Add to `platform/wab/src/wab/server/routes/index.ts`:

```typescript
import * as hosting from "./hosting";

export function addHostingRoutes(app: Express) {
  // Domain management
  app.get("/api/v1/check-domain", hosting.checkDomain);
  app.get("/api/v1/domains-for-project/:projectId", hosting.getDomainsForProject);
  app.put("/api/v1/subdomain-for-project", hosting.setSubdomainForProject);
  app.put("/api/v1/custom-domain-for-project", hosting.setCustomDomainForProject);
  
  // Hosting settings
  app.get("/api/v1/plasmic-hosting/:projectId", hosting.getPlasmicHostingSettings);
  app.put("/api/v1/plasmic-hosting/:projectId", hosting.updatePlasmicHostingSettings);
  
  // Deployment trigger
  app.post("/api/v1/revalidate-hosting", hosting.revalidateHosting);
}
```

Then in `platform/wab/src/wab/server/app-server.ts`, add:

```typescript
// Add after other route registrations
addHostingRoutes(app);
```

### Step 7: Helper Methods for DbMgr

Add these methods to `DbMgr` class:

```typescript
async getProjectsUsingDomain(domain: string): Promise<Project[]> {
  // Search through all project pairs for domain usage
  const projectIds = new Set<string>();
  
  // Check subdomains
  const subdomainPairs = await this.entMgr.find(PairEntity, {
    where: {
      key: "hosting.subdomain",
      value: domain
    }
  });
  
  subdomainPairs.forEach(pair => {
    if (pair.projectId) projectIds.add(pair.projectId);
  });
  
  // Check custom domains
  const customDomainPairs = await this.entMgr.find(PairEntity, {
    where: {
      key: "hosting.customDomains",
      value: Like(`%"${domain}"%`)
    }
  });
  
  customDomainPairs.forEach(pair => {
    if (pair.projectId) projectIds.add(pair.projectId);
  });
  
  if (projectIds.size === 0) return [];
  
  return this.getProjectsById(Array.from(projectIds));
}

async getProjectPair(projectId: string, key: string): Promise<string | null> {
  const pair = await this.entMgr.findOne(PairEntity, {
    where: { projectId, key }
  });
  return pair?.value ?? null;
}

async setProjectPair(projectId: string, key: string, value: string | null): Promise<void> {
  if (value === null) {
    // Delete pair if value is null
    await this.entMgr.delete(PairEntity, { projectId, key });
  } else {
    // Upsert pair
    await this.entMgr.upsert(
      PairEntity,
      { projectId, key, value },
      ["projectId", "key"]
    );
  }
}
```

## Next Steps

### 1. DNS Configuration Service
Implement actual DNS checking:
```typescript
import * as dns from 'dns/promises';

async function checkCNAME(domain: string, expectedTarget: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(domain);
    return records.some(record => record === expectedTarget);
  } catch {
    return false;
  }
}

async function checkARecords(domain: string, expectedIPs: string[]): Promise<boolean> {
  try {
    const records = await dns.resolve4(domain);
    return expectedIPs.every(ip => records.includes(ip));
  } catch {
    return false;
  }
}
```

### 2. Deployment Queue Implementation
Set up a job queue for deployments:
```typescript
import { Queue, Worker } from 'bullmq';

const deploymentQueue = new Queue('plasmic-hosting-deployments', {
  connection: redis
});

// Worker to process deployments
new Worker('plasmic-hosting-deployments', async (job) => {
  const { projectId, trigger, metadata } = job.data;
  
  // 1. Generate static site
  // 2. Upload to your hosting infrastructure
  // 3. Update DNS/routing
  // 4. Send status updates via WebSocket
});
```

### 3. SSL Certificate Management
For custom domains, you'll need SSL:
- Use Let's Encrypt for automatic SSL
- Or integrate with your CDN's SSL management

### 4. Monitoring and Alerts
- Track deployment success/failure rates
- Monitor domain configuration status
- Alert on SSL certificate expiration

## Testing Plan

1. **Unit Tests**: Test each endpoint with various inputs
2. **Integration Tests**: Test full domain configuration flow
3. **DNS Mock**: Mock DNS responses for testing
4. **Load Testing**: Ensure endpoints handle concurrent requests

## Security Considerations

1. **Domain Ownership**: Implement domain verification via DNS TXT records
2. **Rate Limiting**: Limit domain configuration changes
3. **Input Validation**: Thoroughly validate all domain inputs
4. **Permission Checks**: Ensure proper project permissions

This implementation plan provides a complete solution for the missing hosting endpoints while leveraging existing Plasmic components.
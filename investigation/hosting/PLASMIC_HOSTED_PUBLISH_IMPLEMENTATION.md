# Plasmic Hosted Publish Implementation Guide

## Overview

This document details how to implement a custom "hosted" publish option for Plasmic projects, allowing deployment to your own infrastructure instead of Plasmic's managed hosting.

## Current Plasmic Hosted Architecture

### How Plasmic's Hosting Works

1. **Domain Configuration**
   - Subdomains: `*.plasmic.run` (configurable via `HOSTING_SUBDOMAIN_SUFFIX`)
   - Custom domains: User-provided domains with DNS verification
   - Stored in database via "pair" key-value system

2. **Publish Flow**
   ```mermaid
   sequenceDiagram
     User->>Studio: Click Publish
     Studio->>Backend: Save new version
     Backend->>Database: Store PkgVersion
     Backend->>Studio: Version saved
     Studio->>Backend: Call revalidatePlasmicHosting
     Backend->>External Service: Trigger deployment
     External Service->>CDN: Deploy static site
     External Service->>Backend: Status updates
     Backend->>Studio: Show deployment status
   ```

3. **Key Components**
   - **Client**: `PublishFlowDialogWrapper.tsx` orchestrates the flow
   - **API**: `/api/v1/revalidate-plasmic-hosting` (stub in OSS)
   - **Storage**: Domains stored via `DbMgr.getDomainsForProject()`

## Implementing Custom Hosted Publishing

### Architecture Overview

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Plasmic Studio    │────▶│  Publish Webhook │────▶│ Your Deployment │
│                     │     │                  │     │   Pipeline      │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
         │                           │                         │
         ▼                           ▼                         ▼
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Project Version    │     │   Build Queue    │     │  Static Site    │
│    Database         │     │                  │     │   Generator     │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
                                                              │
                                                              ▼
                                                     ┌─────────────────┐
                                                     │   Your CDN/     │
                                                     │   Hosting       │
                                                     └─────────────────┘
```

### Implementation Steps

#### 1. Hook into Publish Events

**Option A: Webhook Integration**

Create a webhook handler in `platform/wab/src/wab/server/routes/webhooks.ts`:

```typescript
// Add to existing webhook handling
export async function handleProjectPublish(
  req: Request,
  project: Project,
  pkgVersion: PkgVersion
) {
  // Trigger your deployment pipeline
  await triggerCustomHostingDeployment({
    projectId: project.id,
    version: pkgVersion.version,
    projectName: project.name,
    domains: await getCustomHostingDomains(project.id)
  });
}
```

**Option B: Extend the Revalidation API**

Replace the stub in `platform/wab/src/wab/server/routes/custom-routes.ts`:

```typescript
export async function revalidatePlasmicHosting(
  req: Request,
  res: Response
) {
  const { projectId } = req.body;
  
  // Get project and latest version
  const mgr = userDbMgr(req);
  const project = await mgr.getProjectById(projectId);
  const latestVersion = await mgr.getLatestPublishedVersion(projectId);
  
  // Queue deployment job
  await deploymentQueue.add({
    projectId,
    version: latestVersion.version,
    timestamp: new Date().toISOString()
  });
  
  res.json({
    queued: true,
    deploymentId: generateDeploymentId()
  });
}
```

#### 2. Create Domain Management System

**Database Schema Extension**:

```sql
-- Add custom hosting configuration table
CREATE TABLE custom_hosting_domains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL REFERENCES projects(id),
  domain TEXT NOT NULL UNIQUE,
  subdomain TEXT,
  ssl_status TEXT DEFAULT 'pending',
  deployment_status TEXT DEFAULT 'inactive',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add deployment tracking
CREATE TABLE hosting_deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  pkg_version_id TEXT NOT NULL,
  status TEXT NOT NULL, -- queued, building, deploying, live, failed
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  deployment_url TEXT,
  error_message TEXT
);
```

#### 3. Build Static Site Generator

Create a worker service for generating static sites:

```typescript
// platform/wab/src/wab/server/workers/static-site-generator.ts
export async function generateStaticSite({
  projectId,
  version,
  outputDir
}: StaticSiteConfig) {
  const dbCon = await getDbCon();
  const mgr = new DbMgr(dbCon, SUPER_USER);
  
  // 1. Fetch project data
  const project = await mgr.getProjectById(projectId);
  const pkgVersion = await mgr.getPkgVersion(projectId, version);
  
  // 2. Generate pages
  const pages = await generateAllPages(project, pkgVersion);
  
  // 3. Generate static assets
  await generateStaticAssets(project, outputDir);
  
  // 4. Create deployment manifest
  await createDeploymentManifest(outputDir, {
    projectId,
    version,
    timestamp: Date.now(),
    pages: pages.map(p => p.path)
  });
  
  return { outputDir, pageCount: pages.length };
}

async function generateAllPages(project: Project, version: PkgVersion) {
  // Extract pages from project bundle
  const bundle = JSON.parse(version.data);
  const pages = [];
  
  for (const page of bundle.pages) {
    // Generate HTML for each page
    const html = await renderPageToHtml({
      project,
      page,
      components: bundle.components
    });
    
    pages.push({
      path: page.path,
      html,
      metadata: page.metadata
    });
  }
  
  return pages;
}
```

#### 4. Implement Deployment Pipeline

**Deployment Queue Worker**:

```typescript
// platform/wab/src/wab/server/workers/deployment-worker.ts
import { Queue, Worker } from 'bullmq';

const deploymentQueue = new Queue('hosting-deployments');

const worker = new Worker('hosting-deployments', async (job) => {
  const { projectId, version } = job.data;
  
  try {
    // Update status
    await updateDeploymentStatus(job.id, 'building');
    
    // Generate static site
    const { outputDir } = await generateStaticSite({
      projectId,
      version,
      outputDir: `/tmp/builds/${projectId}-${version}`
    });
    
    // Deploy to your infrastructure
    await updateDeploymentStatus(job.id, 'deploying');
    const deploymentUrl = await deployToInfrastructure(outputDir, projectId);
    
    // Update DNS if needed
    await updateDNSRecords(projectId, deploymentUrl);
    
    // Mark as complete
    await updateDeploymentStatus(job.id, 'live', deploymentUrl);
    
  } catch (error) {
    await updateDeploymentStatus(job.id, 'failed', null, error.message);
    throw error;
  }
});
```

#### 5. Infrastructure Deployment Options

**Option 1: S3 + CloudFront**

```typescript
async function deployToInfrastructure(buildDir: string, projectId: string) {
  // Upload to S3
  const s3Bucket = `hosted-sites-${projectId}`;
  await uploadDirectoryToS3(buildDir, s3Bucket);
  
  // Create/Update CloudFront distribution
  const distribution = await createOrUpdateDistribution({
    bucket: s3Bucket,
    projectId,
    domains: await getProjectDomains(projectId)
  });
  
  return distribution.domainName;
}
```

**Option 2: Container-Based (Next.js/Remix)**

```typescript
async function deployToContainers(buildDir: string, projectId: string) {
  // Build container
  const imageName = await buildDockerImage({
    context: buildDir,
    dockerfile: 'hosting.Dockerfile',
    tag: `plasmic-site:${projectId}-${Date.now()}`
  });
  
  // Deploy to ECS/K8s
  await deployToECS({
    image: imageName,
    service: `plasmic-hosted-${projectId}`,
    cpu: 256,
    memory: 512
  });
  
  return `${projectId}.sites.yourdomain.com`;
}
```

#### 6. Real-time Status Updates

Implement WebSocket updates for deployment status:

```typescript
// Extend socket backend
export function emitDeploymentStatus(
  projectId: string,
  status: DeploymentStatus
) {
  // Send to all users watching this project
  io.to(`project:${projectId}`).emit('deployment:status', {
    projectId,
    status: status.state,
    progress: status.progress,
    message: status.message,
    url: status.url
  });
}
```

### Configuration & Environment Variables

Add these to your deployment:

```bash
# Hosting Configuration
CUSTOM_HOSTING_ENABLED=true
HOSTING_SUBDOMAIN_SUFFIX=.sites.yourdomain.com
HOSTING_S3_BUCKET=plasmic-hosted-sites
HOSTING_CDN_DISTRIBUTION_ID=EXAMPLEID

# Deployment Queue
REDIS_URL=redis://localhost:6379
DEPLOYMENT_WORKER_CONCURRENCY=5

# Infrastructure
AWS_REGION=us-east-1
ECS_CLUSTER=plasmic-hosting
DOCKER_REGISTRY=your-registry.com
```

### Security Considerations

1. **Domain Verification**
   - Implement DNS TXT record verification
   - Validate SSL certificates
   - Prevent domain hijacking

2. **Access Control**
   - Ensure only project owners can configure hosting
   - Validate deployment permissions
   - Secure webhook endpoints

3. **Resource Limits**
   - Implement deployment quotas
   - Monitor resource usage
   - Rate limit deployments

### Monitoring & Operations

1. **Deployment Metrics**
   ```typescript
   // Track in your monitoring system
   metrics.increment('hosting.deployments.started', { projectId });
   metrics.histogram('hosting.deployment.duration', duration);
   metrics.gauge('hosting.active.sites', activeSiteCount);
   ```

2. **Health Checks**
   - Monitor deployed site availability
   - Track SSL certificate expiration
   - Alert on deployment failures

3. **Logging**
   ```typescript
   logger.info('Deployment started', {
     projectId,
     version,
     domains,
     triggeredBy: userId
   });
   ```

## Integration with Existing Plasmic UI

### 1. Extend Publishing UI

Modify `PublishFlowDialogWrapper.tsx` to add your hosting option:

```typescript
const hostingOptions = [
  { value: 'none', label: 'No hosting' },
  { value: 'plasmic', label: 'Plasmic hosting' },
  { value: 'custom', label: 'Your Infrastructure' } // New option
];
```

### 2. Add Configuration UI

Create settings component for your hosting:

```typescript
// CustomHostingSettings.tsx
export function CustomHostingSettings({ project }: { project: Project }) {
  const [domains, setDomains] = useState<string[]>([]);
  
  return (
    <div>
      <h3>Custom Hosting Configuration</h3>
      <DomainManager 
        domains={domains}
        onChange={setDomains}
        validator={validateCustomDomain}
      />
      <DeploymentHistory projectId={project.id} />
    </div>
  );
}
```

### 3. Status Display

Show deployment status in the UI:

```typescript
// DeploymentStatus.tsx
export function DeploymentStatus({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<DeploymentState>();
  
  useEffect(() => {
    // Subscribe to deployment updates
    const socket = getProjectSocket(projectId);
    socket.on('deployment:status', setStatus);
    
    return () => socket.off('deployment:status', setStatus);
  }, [projectId]);
  
  return (
    <div>
      <StatusBadge state={status?.state} />
      {status?.url && (
        <a href={status.url} target="_blank">
          View deployed site →
        </a>
      )}
    </div>
  );
}
```

## Best Practices

1. **Incremental Deployments**
   - Only rebuild changed pages
   - Use content hashing for cache busting
   - Implement rollback capabilities

2. **Performance Optimization**
   - Pre-render at build time
   - Use edge caching
   - Optimize images during build

3. **Reliability**
   - Implement retry logic
   - Use dead letter queues
   - Monitor deployment success rates

4. **Scalability**
   - Horizontal scaling for build workers
   - CDN for global distribution
   - Database connection pooling

## Example Implementation Timeline

1. **Week 1-2**: Domain management and database schema
2. **Week 3-4**: Static site generator
3. **Week 5-6**: Deployment pipeline and infrastructure
4. **Week 7-8**: UI integration and testing
5. **Week 9-10**: Monitoring, alerts, and optimization

## Conclusion

This implementation provides a complete hosted publishing solution that integrates with Plasmic's existing architecture while deploying to your own infrastructure. The key is to hook into the publish flow, generate static sites efficiently, and provide a seamless user experience with real-time status updates.

The modular design allows you to start simple (S3 static hosting) and evolve to more complex solutions (container-based with SSR) as your needs grow.
# Plasmic Hosting Deployment Architecture

## Overview

Based on the codebase analysis, here's how the real Plasmic hosting deployment should work:

## Current Architecture Understanding

### 1. Plasmic Loader System
- Plasmic projects are served via a "loader" system that generates bundles
- The loader can generate:
  - **Code bundles**: JavaScript/React components
  - **HTML bundles**: Pre-rendered HTML with optional hydration
  - **CSS chunks**: Separate CSS for each component

### 2. Bundle Generation Process
```typescript
// From gen-code-bundle.ts and gen-html-bundle.ts
- Projects have versions (published vs latest)
- Bundles are generated on-demand via the loader API
- Assets are cached in S3 (LOADER_ASSETS_BUCKET)
- CloudFront is used for CDN distribution
```

## Proposed Hosting Deployment Architecture

### Phase 1: Static Site Generation

```typescript
// Update simulateDeployment in hosting.ts
async function deployProjectToHosting(
  domain: string,
  projectId: string,
  projectVersion?: string
): Promise<void> {
  // 1. Generate static assets
  const assets = await generateStaticAssets(projectId, projectVersion);
  
  // 2. Upload to storage (S3)
  const deploymentId = await uploadToStorage(assets, projectId);
  
  // 3. Configure CDN (CloudFront)
  await configureCDN(domain, deploymentId);
  
  // 4. Update DNS if needed
  await updateDNSRecords(domain, projectId);
  
  // 5. Invalidate caches
  await invalidateCaches(domain);
}
```

### Phase 2: Asset Generation

```typescript
interface DeploymentAssets {
  pages: PageAsset[];
  components: ComponentAsset[];
  styles: string[];
  scripts: string[];
  metadata: DeploymentMetadata;
}

async function generateStaticAssets(
  projectId: string, 
  version?: string
): Promise<DeploymentAssets> {
  const mgr = superDbMgr();
  const project = await mgr.getProjectById(projectId);
  
  // Get all pages in the project
  const pages = await getProjectPages(project);
  
  const assets: DeploymentAssets = {
    pages: [],
    components: [],
    styles: [],
    scripts: [],
    metadata: {
      projectId,
      version: version || 'latest',
      generatedAt: new Date(),
      favicon: await getProjectFavicon(projectId)
    }
  };
  
  // Generate each page
  for (const page of pages) {
    // Use existing loader infrastructure
    const bundle = await genLoaderHtmlBundle({
      projectId,
      component: page.name,
      projectToken: project.projectApiToken,
      version,
      hydrate: true,
      prepass: true
    });
    
    assets.pages.push({
      path: page.path || `/${toSlug(page.name)}`,
      html: bundle.html,
      componentName: page.name
    });
  }
  
  // Generate component bundles
  const codeBundle = await genPublishedLoaderCodeBundle({
    projectIdSpecs: [projectId],
    platform: 'react',
    loaderVersion: LATEST_LOADER_VERSION,
    browserOnly: false
  });
  
  assets.components = codeBundle.modules;
  assets.styles = codeBundle.css;
  assets.scripts = codeBundle.external;
  
  return assets;
}
```

### Phase 3: Storage & CDN Configuration

```typescript
// S3 bucket structure
interface S3Structure {
  bucket: 'plasmic-hosting-sites',
  prefix: `sites/${projectId}/${deploymentId}/`,
  objects: {
    'index.html': string;
    'pages/*.html': string[];
    'assets/js/*.js': string[];
    'assets/css/*.css': string[];
    '_plasmic/manifest.json': DeploymentManifest;
  }
}

async function uploadToStorage(
  assets: DeploymentAssets,
  projectId: string
): Promise<string> {
  const deploymentId = generateDeploymentId();
  const s3 = new S3();
  
  // Upload pages
  for (const page of assets.pages) {
    const key = page.path === '/' 
      ? `sites/${projectId}/${deploymentId}/index.html`
      : `sites/${projectId}/${deploymentId}/pages${page.path}.html`;
      
    await s3.putObject({
      Bucket: 'plasmic-hosting-sites',
      Key: key,
      Body: page.html,
      ContentType: 'text/html',
      CacheControl: 'public, max-age=3600'
    }).promise();
  }
  
  // Upload assets with long cache
  for (const [index, module] of assets.components.entries()) {
    await s3.putObject({
      Bucket: 'plasmic-hosting-sites',
      Key: `sites/${projectId}/${deploymentId}/assets/js/component-${index}.js`,
      Body: module.code,
      ContentType: 'application/javascript',
      CacheControl: 'public, max-age=31536000, immutable'
    }).promise();
  }
  
  // Upload manifest
  await s3.putObject({
    Bucket: 'plasmic-hosting-sites',
    Key: `sites/${projectId}/${deploymentId}/_plasmic/manifest.json`,
    Body: JSON.stringify({
      projectId,
      deploymentId,
      generatedAt: new Date(),
      pages: assets.pages.map(p => ({ path: p.path, component: p.componentName }))
    }),
    ContentType: 'application/json'
  }).promise();
  
  return deploymentId;
}
```

### Phase 4: CDN Configuration

```typescript
async function configureCDN(
  domain: string,
  deploymentId: string
): Promise<void> {
  const cloudfront = new CloudFront();
  
  // Check if distribution exists for domain
  let distribution = await findDistributionForDomain(domain);
  
  if (!distribution) {
    // Create new CloudFront distribution
    distribution = await cloudfront.createDistribution({
      DistributionConfig: {
        CallerReference: `plasmic-hosting-${domain}-${Date.now()}`,
        Aliases: {
          Quantity: 1,
          Items: [domain]
        },
        DefaultRootObject: 'index.html',
        Origins: {
          Quantity: 1,
          Items: [{
            Id: 'S3-plasmic-hosting',
            DomainName: 'plasmic-hosting-sites.s3.amazonaws.com',
            S3OriginConfig: {
              OriginAccessIdentity: '' // Use OAI
            },
            OriginPath: `/sites/${projectId}/${deploymentId}`
          }]
        },
        DefaultCacheBehavior: {
          TargetOriginId: 'S3-plasmic-hosting',
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: { Forward: 'none' }
          },
          TrustedSigners: {
            Enabled: false,
            Quantity: 0
          }
        },
        CustomErrorResponses: {
          Quantity: 1,
          Items: [{
            ErrorCode: 404,
            ErrorCachingMinTTL: 300,
            ResponseCode: '200',
            ResponsePagePath: '/index.html'
          }]
        },
        Enabled: true
      }
    }).promise();
  } else {
    // Update existing distribution
    await updateDistributionOrigin(distribution.Id, deploymentId);
  }
  
  // Invalidate cache for immediate update
  await cloudfront.createInvalidation({
    DistributionId: distribution.Id,
    InvalidationBatch: {
      CallerReference: `invalidation-${Date.now()}`,
      Paths: {
        Quantity: 1,
        Items: ['/*']
      }
    }
  }).promise();
}
```

### Phase 5: DNS Management

```typescript
async function updateDNSRecords(
  domain: string,
  projectId: string
): Promise<void> {
  const route53 = new Route53();
  const distribution = await findDistributionForDomain(domain);
  
  // For plasmic.run subdomains
  if (domain.endsWith('.plasmic.run')) {
    const subdomain = domain.replace('.plasmic.run', '');
    
    await route53.changeResourceRecordSets({
      HostedZoneId: PLASMIC_RUN_HOSTED_ZONE_ID,
      ChangeBatch: {
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: domain,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: [{
              Value: distribution.DomainName // CloudFront domain
            }]
          }
        }]
      }
    }).promise();
  }
  
  // For custom domains, provide DNS instructions
  await storeDNSInstructions(domain, distribution.DomainName);
}
```

## Implementation Steps

### 1. Update `revalidateHosting` endpoint
```typescript
export async function revalidateHosting(
  req: Request,
  res: Response
): Promise<void> {
  const { projectId } = req.body as RevalidatePlasmicHostingRequest;
  const mgr = userDbMgr(req);

  try {
    await mgr.checkProjectPerms(projectId as ProjectId, "editor", "revalidate hosting");
    
    const domains = await mgr.getDomainsForProject(projectId as ProjectId);
    const deployment = await deployProjectToHosting(domains, projectId);
    
    res.json({
      successes: deployment.successfulDomains,
      failures: deployment.failedDomains
    } satisfies RevalidatePlasmicHostingResponse);
  } catch (error: any) {
    console.error("Revalidate hosting error:", error);
    res.status(500).json({ error: "Failed to revalidate hosting" });
  }
}
```

### 2. Add deployment tracking
```typescript
// Store deployment history
interface DeploymentRecord {
  id: string;
  projectId: string;
  deploymentId: string;
  domains: string[];
  status: 'pending' | 'success' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}
```

### 3. Add deployment queue
```typescript
// Use a queue for deployments to handle scale
interface DeploymentJob {
  projectId: string;
  domains: string[];
  requestedBy: string;
  priority: 'high' | 'normal' | 'low';
}

// Process deployments asynchronously
async function processDeploymentQueue() {
  const job = await deploymentQueue.getNext();
  if (job) {
    await deployProject(job);
  }
}
```

## Benefits of This Architecture

1. **Leverages existing infrastructure**: Uses the existing loader system for generating content
2. **Scalable**: S3 + CloudFront can handle any scale
3. **Fast**: Pre-generated static content served from CDN edge locations
4. **Reliable**: Built on AWS managed services
5. **Cost-effective**: Pay only for storage and bandwidth used

## Next Implementation Steps

1. Set up S3 bucket and CloudFront distribution
2. Implement asset generation using existing loader
3. Add deployment tracking to database
4. Implement DNS management for plasmic.run domains
5. Add deployment status webhooks
6. Create deployment preview functionality
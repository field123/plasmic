# Plasmic Next.js Hosting Architecture

## Overview

Use Next.js as the runtime for Plasmic's hosted offering, providing a familiar, powerful, and flexible platform for users' Plasmic projects.

## Architecture Components

### 1. Next.js App Template

Each hosted Plasmic project runs as a Next.js application with:

```typescript
// app/[[...catchall]]/page.tsx
import { PlasmicComponent } from '@plasmicapp/loader-nextjs';
import { PLASMIC } from '@/plasmic-init';
import { notFound } from 'next/navigation';

export const revalidate = 3600; // ISR: revalidate every hour

interface PageProps {
  params: { catchall: string[] };
  searchParams?: { [key: string]: string | string[] };
}

export async function generateStaticParams() {
  const pages = await PLASMIC.fetchPages();
  return pages.map((page) => ({
    catchall: page.path.substring(1).split("/").filter(Boolean),
  }));
}

export default async function PlasmicLoaderPage({ params, searchParams }: PageProps) {
  const plasmicPath = "/" + (params?.catchall?.join("/") ?? "");
  const plasmicData = await PLASMIC.maybeFetchComponentData(plasmicPath);
  
  if (!plasmicData) {
    notFound();
  }

  return (
    <PlasmicComponent 
      component={plasmicPath} 
      componentProps={{
        // Pass search params as props
        ...searchParams,
        // Pass path params
        ...plasmicData.entryCompMetas[0]?.params,
      }}
    />
  );
}
```

### 2. Deployment Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Plasmic Studio │────▶│  Hosting Service  │────▶│   Next.js App   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                          │
                               │                          ▼
                               │                   ┌─────────────┐
                               └──────────────────▶│   Vercel/   │
                                                   │  AWS Lambda │
                                                   └─────────────┘
```

### 3. Deployment Options

#### Option A: Vercel (Recommended for MVP)
- **Pros**: 
  - Native Next.js support
  - Automatic scaling
  - Global edge network
  - Preview deployments
  - Easy domain management
- **Implementation**: Use Vercel API to create projects and deployments

#### Option B: AWS with SST/CDK
- **Pros**: 
  - Full control over infrastructure
  - Cost optimization at scale
  - Can use existing AWS resources
- **Implementation**: 
  - Lambda@Edge for SSR
  - CloudFront for caching
  - S3 for static assets

### 4. Key Features

#### Dynamic Routing & ISR
```typescript
// app/product/[productId]/page.tsx
export const revalidate = 60; // Revalidate every minute

export async function generateStaticParams() {
  // Optionally pre-generate some paths
  return [];
}

export default async function ProductPage({ params }) {
  // This works with dynamic [productId] paths
  // Next.js handles the routing automatically
}
```

#### API Routes for Webhooks
```typescript
// app/api/revalidate/route.ts
import { revalidatePath, revalidateTag } from 'next/cache';

export async function POST(request: Request) {
  const { path, tag } = await request.json();
  
  if (path) {
    revalidatePath(path);
  }
  
  if (tag) {
    revalidateTag(tag);
  }
  
  return Response.json({ revalidated: true });
}
```

#### Environment Variables
```typescript
// Each deployment gets:
PLASMIC_PROJECT_ID=xxx
PLASMIC_PROJECT_TOKEN=xxx
PLASMIC_PREVIEW_SECRET=xxx
```

### 5. Implementation Plan

#### Phase 1: MVP
1. Create Next.js app template with Plasmic loader
2. Set up Vercel deployment pipeline
3. Implement domain configuration
4. Basic ISR support

#### Phase 2: Advanced Features
1. Preview mode with draft content
2. A/B testing support
3. Analytics integration
4. Custom middleware support

#### Phase 3: Scale & Optimization
1. Multi-region deployments
2. Advanced caching strategies
3. Database/CMS integrations
4. Custom build plugins

### 6. Deployment Flow

```typescript
async function deployProject(projectId: string) {
  // 1. Create/update Next.js app from template
  const appCode = await generateNextApp({
    projectId,
    projectToken: getProjectToken(projectId),
  });
  
  // 2. Create git repo (optional)
  const repo = await createGitRepo(projectId, appCode);
  
  // 3. Deploy to Vercel
  const deployment = await vercelClient.createDeployment({
    name: `plasmic-${projectId}`,
    files: appCode,
    projectSettings: {
      framework: 'nextjs',
      buildCommand: 'npm run build',
      outputDirectory: '.next',
    },
    env: {
      PLASMIC_PROJECT_ID: projectId,
      PLASMIC_PROJECT_TOKEN: projectToken,
    }
  });
  
  // 4. Configure domain
  await configureDomain(deployment.url, customDomain);
  
  return deployment;
}
```

### 7. Benefits of Next.js Approach

1. **No Path Pre-generation**: Dynamic routes work out of the box
2. **ISR Support**: Pages regenerate on-demand based on revalidation rules
3. **Full React Ecosystem**: Users can add custom code, components, integrations
4. **Performance**: Built-in optimizations, automatic code splitting
5. **Developer Experience**: Familiar to React developers
6. **Flexibility**: Can start static and add dynamic features as needed

### 8. Migration from Static

For existing static hosting approach:
1. Generate Next.js app instead of static HTML
2. Deploy to Vercel/AWS instead of S3
3. Update domain configuration to point to Next.js app
4. Existing page extraction logic can be reused for `generateStaticParams`
# Plasmic Codegen and Loader Architecture

## Overview

Plasmic provides two distinct approaches for integrating visual designs into React applications: **Loader (Headless API)** and **Codegen**. This document clarifies the architecture, use cases, and infrastructure requirements for each approach.

## Key Concepts

### 1. Loader System (Headless API)
The Loader system provides runtime loading of Plasmic components without generating local files.

**Characteristics:**
- Components fetched at runtime via `/api/v1/loader/*` endpoints
- No code files in your repository
- Instant updates from Plasmic Studio
- Requires network requests on page load
- Used by `@plasmicapp/loader-react` and similar packages

**How it works:**
1. Your app imports `PlasmicComponent` from `@plasmicapp/loader-react`
2. At runtime, it fetches bundled JavaScript from Plasmic servers
3. Components are evaluated and rendered dynamically
4. Changes in Studio reflect immediately without deployment

### 2. Traditional Codegen
Codegen generates actual React component files that are checked into your repository.

**Characteristics:**
- Run `plasmic sync` to generate `.tsx`/`.jsx` files
- Full control over generated code
- No runtime API calls
- Components built as part of your build process
- Uses `/api/v1/codegen/*` endpoints via CLI

**How it works:**
1. Developer runs `plasmic sync` command
2. CLI fetches component data and generates React files
3. Files are saved to your project directory
4. You build and deploy normally with your code

## Architecture Comparison

| Aspect | Loader (Headless) | Traditional Codegen |
|--------|------------------|-------------------|
| **Local Files** | None | `.tsx`/`.jsx` files |
| **Updates** | Instant/runtime | Requires `plasmic sync` |
| **Network Calls** | Every page load | Only during sync |
| **Customization** | Limited | Full code access |
| **Version Control** | No Plasmic code | Plasmic code in repo |
| **Build Size** | Smaller | Larger |
| **Performance** | Initial load penalty | No runtime overhead |

## Infrastructure Requirements

### Loader System Infrastructure

The loader system requires significant backend infrastructure for performance:

#### S3 Caching Layer
- **Purpose**: Cache generated and bundled code to avoid expensive regeneration
- **Without cache**: Each request would take 500ms-5s (codegen + bundling)
- **With cache**: Requests complete in ~50ms

**S3 Bucket Structure:**
```
s3://plasmic-loader-assets/
  ├── codegen/    # Generated React code per project/version
  │   └── cb=20/pid=PROJECT_ID/v=VERSION/opts=HASH
  └── bundle/     # Bundled JavaScript modules
      └── cb=20/loaderVersion=10/ps=SPECS/platform=react/opts=HASH
```

**Cache Key Components:**
- `cb`: Cache bust version (incremented to invalidate all caches)
- `pid`: Project ID
- `v`: Version (specific version or "latest")
- `opts`: SHA256 hash of all options affecting output

#### Server-Side Processing

1. **Code Generation** (~150-200ms)
   - Convert Plasmic designs to React components
   - Generate optimized CSS
   - Handle variants, slots, and bindings

2. **Bundling** (~150-200ms)
   - Run webpack/esbuild
   - Include dependencies
   - Tree-shake and minify
   - Generate source maps

3. **Caching Strategy**
   - Versioned content cached forever (immutable)
   - "Latest" versions never cached (always fresh)
   - Prefill common configurations on publish

### Traditional Codegen Infrastructure

Minimal infrastructure - only requires:
- Access to `/api/v1/codegen/*` endpoints during development
- No runtime infrastructure needed
- No caching layer required

## When to Use Each Approach

### Use Loader (Headless) When:
- You want instant updates from designers
- Using Next.js or Gatsby
- Building marketing sites with frequent changes
- You don't need code customization
- Simplified deployment is priority

### Use Traditional Codegen When:
- You need full control over code
- Using frameworks beyond Next.js/Gatsby
- Building applications vs websites
- Performance is critical (no runtime loading)
- You want code in version control

## Production Deployment

### Loader Deployment Requirements

1. **Separate Codegen Service** (recommended)
   ```
   Main App (port 3004) → User-facing application
   Codegen Service (port 3008) → Handles /api/v1/loader/* requests
   ```

2. **S3 Bucket Configuration**
   ```bash
   # Environment variables needed
   LOADER_ASSETS_BUCKET=your-plasmic-loader-assets
   AWS_REGION=eu-west-1
   ```

3. **IAM Permissions**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject", "s3:PutObject"],
       "Resource": "arn:aws:s3:::your-plasmic-loader-assets/*"
     }]
   }
   ```

4. **Load Balancer Rules**
   - Route `/api/v1/loader/*` to codegen service
   - Route all other traffic to main app

### Traditional Codegen Deployment
- No special infrastructure needed
- Deploy like any React application
- Only requirement: `plasmic sync` during CI/CD

## Performance Implications

### Loader Performance
- **First Load**: 50-100ms (S3 cache hit) or 500ms-5s (cache miss)
- **Subsequent Loads**: Can be cached by CDN
- **Trade-off**: Runtime flexibility vs initial load time

### Codegen Performance
- **First Load**: No API calls needed
- **Bundle Size**: Includes all Plasmic code
- **Trade-off**: Larger bundle vs no runtime overhead

## Security Considerations

### Codegen Service Isolation
Running codegen as a separate service provides:
- Protection against server-side rendering vulnerabilities
- Resource isolation for expensive operations
- Independent scaling based on load

### API Authentication
Both systems use project API tokens:
- Format: `projectId:token`
- Header: `x-plasmic-api-project-tokens`
- Tokens grant read-only access to project data

## Common Misconceptions

1. **"Codegen" in loader context**: The loader does generate code server-side, but this is for runtime delivery, not file generation
2. **"Headless API" terminology**: Refers to the loader system, not a separate REST API
3. **Cache requirements**: Only needed for loader system, not traditional codegen
4. **Performance**: Loader can be fast with proper caching, but adds complexity

## Conclusion

Choose based on your needs:
- **Loader**: Better for content-heavy sites with non-technical editors
- **Codegen**: Better for applications requiring code control and optimization

Both are production-ready with proper infrastructure setup.
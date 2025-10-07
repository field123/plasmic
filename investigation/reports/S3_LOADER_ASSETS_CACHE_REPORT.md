# S3 Loader Assets Cache - Comprehensive Analysis Report

## Executive Summary

The S3 bucket for loader assets (`plasmic-loader-assets-dev` or production equivalent) is a critical performance optimization infrastructure that caches both code generation outputs and bundled JavaScript/CSS modules. This caching system is **exclusively used by the loader endpoints** and is essential for serving Plasmic projects at scale with acceptable performance.

## 1. The Problem it Solves

### Without Cache:
- **Every request would trigger expensive code generation**: Converting Plasmic's visual designs (stored as data structures) into React components requires complex AST transformations
- **Every request would require bundling**: After code generation, the generated code must be bundled with dependencies like `@plasmicapp/react-web` and various `@plasmicpkgs/*` packages
- **Massive computational overhead**: Each project request would consume significant CPU and memory resources
- **Poor user experience**: End users would experience multi-second delays loading Plasmic-powered pages
- **Server overload**: The system would require provisioning massive compute resources to handle production traffic

### Evidence from Code:
From `gen-code-bundle.ts` line 33-35:
```typescript
/**
 * Note that incrementing this number is EXPENSIVE and will create a huge volume of
 * codegen requests!  Provision codegen cluster appropriately.
 */
```

This comment explicitly acknowledges that cache busting is expensive and requires careful capacity planning.

## 2. Performance Impact

### Timing Instrumentation:
The codebase uses `withSpan` from `apm-util.ts` to measure performance of key operations:

```typescript
// From gen-code-bundle.ts
await withSpan("loader-resolve-deps", async () => {...})
await withSpan("loader-codegen", async () => {...})
await withSpan("loader-bundle", async () => {...})
await withSpan("loader-bundle-esbuild", async () => {...})
```

Each span logs timing information:
```typescript
logger().info(`${name} took ${new Date().getTime() - start}ms${suffix}`);
```

### Cache Hit/Miss Logging:
From `s3-util.ts`:
- Cache hit: `console.log(\`S3 cache hit for ${bucket} ${key}\`);`
- Cache miss: `console.log(\`S3 cache miss for ${bucket} ${key}; computing\`);`

## 3. What Gets Cached

### Two Types of Cached Data:

#### A. Code Generation Output (per project/version)
Stored at path: `codegen/cb={CACHE_BUST}/pid={projectId}/v={version}/indirect={indirect}/opts={optsHash}`

Contains:
- Generated React components
- CSS modules  
- Icon and image assets
- Global variant configurations
- Project configuration
- Code component metadata
- Style tokens
- Active splits configuration

#### B. Bundled Assets (for project combinations)
Stored at path: `bundle/cb={CACHE_BUST}/loaderVersion={version}/ps={projectSpecs}/platform={platform}/browserOnly={bool}/opts={optsHash}`

Contains:
- Bundled JavaScript modules (separate for browser/server)
- Minified CSS assets
- Module dependency graph
- External dependencies list

## 4. Cache Key Strategy

### Codegen Cache Keys Include:
- `LOADER_CACHE_BUST`: Global cache version (currently "20")
- `projectId`: Unique project identifier
- `version`: Specific version or "latest"
- `indirect`: Whether project is a dependency
- `opts`: SHA256 hash of export options

### Bundle Cache Keys Include:
- All codegen key components
- `loaderVersion`: API compatibility version (0-10)
- `projectSpecs`: Sorted list of "projectId@version"
- `platform`: react/nextjs/gatsby/tanstack
- `browserOnly`: Whether server-side code is needed

The use of SHA256 hashing for options prevents cache key length from exceeding S3's 1024 character limit.

## 5. Code Generation Cost

Code generation is expensive because it involves:

1. **Loading and parsing project data**: Deserializing complex project structures from the database
2. **Component tree traversal**: Walking through every component's node tree
3. **React code generation**: Converting visual elements to JSX
4. **CSS generation**: Creating styled-components or CSS modules
5. **Asset processing**: Handling images, icons, and fonts
6. **Dependency analysis**: Building component dependency graphs
7. **Multiple output formats**: Generating both browser and server builds

## 6. Bundle Generation Process

The bundling process (using esbuild) is expensive due to:

1. **Multi-target builds**: Separate builds for browser and Node.js
2. **Code splitting**: Extracting shared code into reusable chunks
3. **Tree shaking**: Removing unused code
4. **Minification**: Compressing JavaScript and CSS
5. **Module transformation**: Converting ESM to CommonJS
6. **External dependency handling**: Managing React, Next.js, etc.
7. **CSS processing**: Combining and minifying stylesheets

From `module-bundler.ts`, the process involves:
- First building as ESM with code splitting
- Then converting to CommonJS format
- Special handling for various package compatibility issues

## 7. Cache Hit/Miss Flow

### Cache Hit Flow:
1. Request arrives at loader endpoint
2. Cache key is computed from request parameters
3. S3 is checked for existing entry
4. If found, cached data is returned immediately
5. Response is served to client

### Cache Miss Flow:
1. Request arrives at loader endpoint
2. Cache key is computed
3. S3 lookup fails
4. For versioned content:
   - Code generation runs in worker pool
   - Bundle generation runs in worker pool
   - Results are stored in S3
   - Results are returned to client
5. For "latest" content:
   - No caching occurs (always fresh)
   - ETags are used for client-side caching

## 8. Lifecycle

### Cache Addition:
- **Production builds**: Cached when version is specified (not "latest")
- **Prefilling**: When a new version is published, `prefillCloudfront` proactively generates common combinations
- **On-demand**: Cache entries created on first request if not prefilled

### Cache Staleness:
- **Immutable by design**: Versioned content never changes
- **Cache busting**: `LOADER_CACHE_BUST` incremented when fixing bugs
- **No expiration**: Cached content remains valid indefinitely
- **Latest versions**: Not cached, always regenerated

## 9. Multi-tenant Considerations

### Project Isolation:
- Each project's code is generated independently
- Cache keys include project IDs ensuring no cross-contamination
- Bundle cache keys include all participating project IDs

### Loader Publishment Tracking:
The system tracks usage patterns via `LoaderPublishment` entities to optimize prefilling:
- Platform (react/nextjs/gatsby)
- Loader version
- Browser-only vs full builds
- i18n configurations
- Project combinations

### Prefilling Strategy:
When a project publishes a new version:
1. System queries recent `LoaderPublishment` records
2. Identifies common configuration combinations
3. Proactively generates and caches those combinations
4. Reduces cache misses for popular configurations

## 10. Evidence and Rationale

### Performance Requirements:
- Plasmic serves as infrastructure for production websites
- Users expect fast page loads (sub-second)
- Without caching, generation + bundling would take several seconds

### Scale Considerations:
- Multiple projects may be loaded together (dependencies)
- Same project may be requested with different configurations
- Popular projects may receive thousands of requests per second

### Cost Optimization:
- S3 storage is cheap compared to compute
- Cache hits avoid expensive CPU/memory usage
- Reduces need for massive server clusters

### Architectural Benefits:
- Separation of concerns: Generation vs serving
- Horizontal scalability: Cache can be distributed
- Reliability: S3 provides high availability
- Performance: CloudFront CDN integration

## Conclusion

The S3 loader assets cache is a critical component that makes Plasmic's loader architecture viable at scale. It transforms an expensive, CPU-intensive process into a simple storage lookup for the vast majority of requests. The caching strategy is carefully designed to balance freshness (for development) with performance (for production), while maintaining isolation between different projects and configurations.

The cache is used **exclusively by the loader endpoints** - not by the publishing process or other endpoints. The publishing process may trigger cache prefilling, but it doesn't directly use the cache for its own operations.
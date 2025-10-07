# Plasmic Hosting: SSR vs SSG Architecture

## Overview

Plasmic hosting supports both Static Site Generation (SSG) and Server-Side Rendering (SSR) to provide optimal performance and flexibility for different use cases.

## Deployment Strategies

### 1. Static Site Generation (SSG)
Best for:
- Marketing pages
- Documentation
- Content that doesn't change per user
- Maximum performance

Architecture:
```
User Request → CloudFront → S3 (pre-rendered HTML)
```

### 2. Server-Side Rendering (SSR)
Best for:
- Dynamic content
- User-specific pages
- Real-time data
- SEO for frequently changing content

Architecture:
```
User Request → CloudFront → API Gateway → Lambda → Render HTML
                    ↓
                 (Cache)
```

### 3. Hybrid Approach
Most projects use both:
- SSG for public pages (home, about, pricing)
- SSR for dynamic pages (dashboard, user profiles)

## Implementation Details

### SSG Pages

1. **Build Time**: Pages are pre-rendered during deployment
2. **Storage**: HTML files stored in S3
3. **Serving**: CloudFront serves directly from S3
4. **Performance**: Extremely fast (no compute needed)
5. **Cost**: Very low (only storage + bandwidth)

```typescript
// Example SSG page configuration
{
  path: "/",
  componentName: "Homepage",
  renderStrategy: "static",
  revalidate: 3600 // Rebuild every hour
}
```

### SSR Pages

1. **Request Time**: Pages rendered on each request
2. **Compute**: Lambda functions handle rendering
3. **Data Fetching**: Can fetch fresh data per request
4. **Caching**: CloudFront caches based on headers
5. **Cost**: Higher (compute + bandwidth)

```typescript
// Example SSR page configuration
{
  path: "/dashboard",
  componentName: "Dashboard",
  renderStrategy: "server",
  dataFetching: {
    type: "getServerSideProps",
    endpoint: "/api/user/data"
  },
  cachePolicy: {
    maxAge: 60, // Cache for 1 minute
    vary: ["Cookie"] // Cache per user
  }
}
```

## Page Classification Logic

The system automatically determines the best rendering strategy:

```typescript
function classifyPage(page: PlasmicPage): RenderStrategy {
  // SSR if page has:
  if (page.hasDataQueries) return "server";
  if (page.hasAuthRequirement) return "server";
  if (page.hasPersonalization) return "server";
  if (page.updateFrequency > "hourly") return "server";
  
  // Otherwise SSG
  return "static";
}
```

## CloudFront Configuration

### For SSG Content
```javascript
{
  CacheBehaviors: [{
    PathPattern: "/static/*",
    TargetOriginId: "S3-Origin",
    ViewerProtocolPolicy: "redirect-to-https",
    CachePolicyId: "Managed-CachingOptimized", // Long cache
    ResponseHeadersPolicyId: "Managed-CORS-S3Origin"
  }]
}
```

### For SSR Content
```javascript
{
  CacheBehaviors: [{
    PathPattern: "/dynamic/*",
    TargetOriginId: "APIGateway-Origin",
    ViewerProtocolPolicy: "redirect-to-https",
    CachePolicyId: "Custom-SSR-Policy",
    OriginRequestPolicyId: "Custom-Forward-Headers",
    AllowedMethods: ["GET", "HEAD", "OPTIONS"],
    CachedMethods: ["GET", "HEAD"],
    ForwardedValues: {
      QueryString: true,
      Headers: ["Accept", "Accept-Language", "Cookie"],
      Cookies: { Forward: "whitelist", WhitelistedNames: ["session"] }
    }
  }]
}
```

## Lambda Function Architecture

### SSR Lambda Structure
```
plasmic-ssr-handler/
├── index.js          # Main handler
├── renderer.js       # Plasmic rendering logic
├── data-fetcher.js   # Data source integration
├── cache.js          # Response caching
└── node_modules/     # Dependencies
```

### Lambda@Edge for Enhanced Performance
For global SSR, use Lambda@Edge:
- Runs at CloudFront edge locations
- Lower latency for users
- Can modify requests/responses
- Perfect for A/B testing

## Data Fetching Patterns

### 1. Static Data (SSG)
```typescript
// Fetched at build time
export async function getStaticProps() {
  const data = await fetch('https://api.example.com/products');
  return {
    props: { products: data },
    revalidate: 3600 // ISR - rebuild every hour
  };
}
```

### 2. Dynamic Data (SSR)
```typescript
// Fetched on each request
export async function getServerSideProps(context) {
  const userId = context.req.cookies.userId;
  const userData = await fetch(`/api/users/${userId}`);
  return {
    props: { user: userData }
  };
}
```

### 3. Plasmic Data Sources
```typescript
// Integrated with Plasmic's data layer
{
  dataFetching: {
    type: "plasmic-data",
    queries: [
      {
        name: "userProfile",
        collection: "users",
        filter: { id: "$auth.userId" }
      }
    ]
  }
}
```

## Performance Optimization

### 1. Edge Caching Strategy
- SSG: Cache forever (with cache busting on deploy)
- SSR: Cache based on content type
  - Public data: 5-60 minutes
  - User data: No cache or short cache with Vary: Cookie
  - API responses: Cache with ETag validation

### 2. Incremental Static Regeneration (ISR)
- Combine benefits of SSG and SSR
- Serve static files but rebuild in background
- Perfect for content sites

### 3. Streaming SSR
- Start sending HTML before full render
- Improves Time to First Byte (TTFB)
- Better perceived performance

## Cost Considerations

### SSG Costs
- S3 Storage: ~$0.023 per GB/month
- CloudFront: ~$0.085 per GB transfer
- Nearly zero compute cost

### SSR Costs
- Lambda: ~$0.20 per 1M requests
- Lambda duration: ~$0.0000166667 per GB-second
- API Gateway: ~$3.50 per million requests
- Higher CloudFront costs due to less caching

### Optimization Tips
1. Use SSG wherever possible
2. Implement proper caching for SSR
3. Use CloudFront compression
4. Minimize Lambda cold starts
5. Consider regional deployments

## Migration Path

For existing Plasmic projects:

1. **Phase 1**: Deploy all pages as SSG
2. **Phase 2**: Identify pages needing SSR
3. **Phase 3**: Implement SSR for specific pages
4. **Phase 4**: Optimize caching strategies
5. **Phase 5**: Add edge computing where beneficial

## Monitoring and Analytics

### Key Metrics
- **SSG**: Cache hit ratio, origin requests
- **SSR**: Lambda duration, cold starts, errors
- **Both**: Page load time, Core Web Vitals

### Recommended Tools
- CloudWatch for AWS metrics
- Real User Monitoring (RUM) for performance
- X-Ray for distributed tracing
- CloudFront reports for cache analytics
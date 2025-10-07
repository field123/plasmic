# Why We Need to Extract Pages from Bundles

## Understanding Plasmic's Architecture

### 1. Plasmic Project Structure
```
Plasmic Project
├── Components (reusable UI elements)
│   ├── Header
│   ├── Footer
│   └── Button
└── Pages (routable pages with URLs)
    ├── Homepage (path: "/")
    ├── About (path: "/about")
    └── Contact (path: "/contact")
```

### 2. Bundle Structure
When Plasmic saves a project, it serializes everything into a "bundle":
```javascript
{
  site: {
    components: [
      {
        name: "Header",
        type: "plain", // Regular component
        // ... component data
      },
      {
        name: "Homepage", 
        type: "page", // This is a PAGE!
        pageMeta: {
          path: "/",
          title: "Welcome to our site",
          description: "SEO description"
        },
        // ... page component data
      }
    ]
  }
}
```

### 3. Why Extract Pages for Hosting?

When deploying to hosting, we need to:

1. **Generate separate HTML files for each page**
   - `/index.html` for Homepage
   - `/about.html` for About page
   - `/contact.html` for Contact page

2. **Know the URL routing**
   - The `pageMeta.path` tells us where each page should be accessible

3. **Configure proper SEO metadata**
   - Title, description, OG images from `pageMeta`

4. **Only deploy pages, not components**
   - Components are embedded in pages, not standalone

## The Extraction Process

```typescript
// What happens during deployment:

1. Load project bundle from database
   bundle = await mgr.loadProjectRevBundle(projectId, revisionId);

2. Extract pages from bundle
   pages = extractPagesFromBundle(bundle);
   // Returns: [
   //   { name: "Homepage", path: "/" },
   //   { name: "About", path: "/about" }
   // ]

3. Generate HTML for each page
   for (const page of pages) {
     const html = await genLoaderHtmlBundle({
       component: page.name, // "Homepage"
       // ... other options
     });
     
     // Save to correct path
     await uploadToS3(`${page.path}.html`, html);
   }
```

## Without Extraction

If we don't extract pages:
- ❌ We don't know which components are pages
- ❌ We don't know what URLs to generate
- ❌ We might try to render non-page components
- ❌ We miss SEO metadata
- ❌ Routing won't work

## Component vs Page Example

```javascript
// Regular Component (should NOT be deployed as standalone)
{
  name: "Button",
  type: "plain",
  // No pageMeta - this is just a reusable component
}

// Page Component (SHOULD be deployed)
{
  name: "Product Page",
  type: "page",
  pageMeta: {
    path: "/products/[slug]", // Dynamic route
    title: "{{product.name}} - Our Store",
    description: "Buy {{product.name}} online"
  }
}
```

## Dynamic Pages

Pages can have dynamic paths:
```javascript
{
  name: "Blog Post",
  type: "page",
  pageMeta: {
    path: "/blog/[slug]", // Dynamic segment
    params: {
      slug: { type: "string" }
    }
  }
}
```

For SSG, we'd need to:
1. Fetch all possible slugs
2. Generate static HTML for each

For SSR, we'd:
1. Render on-demand with the provided slug

## Summary

Extracting pages from bundles is essential because:

1. **Plasmic stores everything together** - pages and components in one bundle
2. **Only pages have URLs** - components don't have routes
3. **Pages have special metadata** - SEO, routing, params
4. **Deployment needs to know what to generate** - which components are actual pages

The `extractPagesFromBundle` function is the bridge between Plasmic's internal data model and the hosting deployment system.
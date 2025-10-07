# Setting Up Plasmic CMS Package in Self-Hosted Deployment

## Overview

This guide documents the process of adding the Plasmic CMS package to a self-hosted Plasmic deployment. The CMS package is a hostless code component package that requires specific database entries and configuration.

## Key Concepts

### Hostless Packages

- Hostless packages are code components that run entirely in the Plasmic Studio
- They are distributed as `ProjectDependency` bundles, not regular `Site` bundles
- Components won't appear in the project view but in the Component Store

### Required Database Entities

1. **Project** - Contains the component definitions
2. **Pkg** - System package registration
3. **PkgVersion** - Version information with the bundled model
4. **DevFlag Configuration** - Makes components available in Component Store

## Setup Steps

### 1. Import the Package Bundle

The CMS bundle is a `ProjectDependency` type. When importing:

- Extract the `Site` object from the bundle to create a proper project
- The bundle structure is: `bundle.map[bundle.root].site.__ref` points to the Site

```typescript
// Example: Converting ProjectDependency bundle to Site bundle
const projDep = bundle.map[bundle.root];
const siteRef = projDep.site.__ref;
const projectBundle = {
  version: bundle.version,
  root: siteRef, // Use Site as root instead of ProjectDependency
  map: bundle.map,
};
```

### 2. Create Database Entries

#### Create Project and Package

```typescript
const { project } = await mgr.createProject({
  name: "Plasmic CMS Components",
  inviteOnly: false,
});

const pkg = await mgr.createSysPkg("plasmic-cms", project.id);
```

#### Create Package Version (Critical Step)

```typescript
const pkgVersion = await mgr.insertPkgVersion(
  pkg.id,
  "6.47.0", // version
  JSON.stringify(originalBundle), // Use original ProjectDependency bundle as model
  [], // tags
  "Plasmic CMS components", // description
  latestRevision.revision
);
```

**Important**: The `model` field should contain the original `ProjectDependency` bundle, not a Site bundle.

### 3. Configure DevFlags

Add to `hostLessComponents` in devflag overrides:

```json
{
  "hostLessComponents": [
    {
      "sectionLabel": "CMS",
      "type": "hostless-package",
      "name": "Plasmic CMS",
      "isHeaderLess": true,
      "pkg": "plasmic-cms",
      "codeName": "plasmic-cms",
      "items": [
        {
          "type": "hostless-component",
          "componentName": "hostless-plasmic-cms-query-repeater",
          "displayName": "CMS Data Loader"
        }
      ],
      "disabledItems": [
        // Other components hidden but available when needed
      ],
      "projectId": "YOUR_PROJECT_ID"
    }
  ]
}
```

## Common Issues

### Components Not Visible

- Hostless components appear in Component Store, not in the project component list
- Ensure `pkg_version` entry exists - `createSysPkg` alone is insufficient
- Check devflag configuration includes the correct project ID

### Bundle Type Mismatch

- Admin import expects `Site` bundles but CMS is a `ProjectDependency`
- Must handle this programmatically or use direct database insertion

### Missing pkg_version

- `createSysPkg` doesn't create `pkg_version` entries
- Must explicitly call `insertPkgVersion` with the bundle as model

## Verification

Check installation with:

```sql
-- Should return both pkg and pkg_version entries
SELECT p.*, pv.version
FROM pkg p
LEFT JOIN pkg_version pv ON p.id = pv."pkgId"
WHERE p.name = 'plasmic-cms';
```

## Result

Once properly configured, the CMS components will appear in the Component Store under the "CMS" section, allowing users to add content management capabilities to their projects.

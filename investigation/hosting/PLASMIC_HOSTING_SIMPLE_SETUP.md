# Plasmic Hosting - Simple Setup Guide

## Current Implementation Status

We've simplified the hosting implementation to focus on static content deployment only:

✅ **What's Working:**
- Domain configuration endpoints
- Basic static page generation
- S3 upload structure
- Simple deployment flow

🚧 **What's Simplified:**
- No SSR (server-side rendering) - static only
- Mock page extraction (returns Homepage only)
- No real CloudFront configuration yet
- No actual DNS management

## Quick Start

### 1. Set AWS Credentials
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=us-east-1
export PLASMIC_HOSTING_BUCKET=plasmic-hosting-sites
```

### 2. Create S3 Bucket
```bash
# Create bucket
aws s3 mb s3://plasmic-hosting-sites

# Set bucket policy for public read
aws s3api put-bucket-policy --bucket plasmic-hosting-sites --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicRead",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::plasmic-hosting-sites/*"
  }]
}'

# Enable static website hosting
aws s3 website s3://plasmic-hosting-sites \
  --index-document index.html \
  --error-document error.html
```

### 3. Test Deployment Flow
```bash
# From platform/wab directory
yarn ts-node test-hosting-deployment.ts
```

## What Happens During Deployment

1. **Generate Static HTML**
   ```
   Homepage → index.html
   ```

2. **Upload to S3**
   ```
   s3://plasmic-hosting-sites/
   └── sites/
       └── {projectId}/
           └── {deploymentId}/
               ├── index.html
               └── _plasmic/
                   └── manifest.json
   ```

3. **Access Your Site**
   ```
   http://plasmic-hosting-sites.s3-website-us-east-1.amazonaws.com/sites/{projectId}/{deploymentId}/
   ```

## Next Implementation Steps

### Step 1: Fix Page Extraction
The current implementation only generates a Homepage. We need to:
1. Actually load the project bundle from the database
2. Extract all pages with their correct paths
3. Generate HTML for each page

### Step 2: Add CloudFront
```javascript
// Simple CloudFront setup
const cf = new AWS.CloudFront();
const distribution = await cf.createDistribution({
  DistributionConfig: {
    Origins: [{
      DomainName: 'plasmic-hosting-sites.s3.amazonaws.com',
      Id: 'S3-Origin',
      S3OriginConfig: {
        OriginAccessIdentity: ''
      }
    }],
    DefaultRootObject: 'index.html',
    Enabled: true
  }
}).promise();
```

### Step 3: Basic DNS for plasmic.run
```javascript
// Route53 for *.plasmic.run
const route53 = new AWS.Route53();
await route53.changeResourceRecordSets({
  HostedZoneId: PLASMIC_RUN_ZONE_ID,
  ChangeBatch: {
    Changes: [{
      Action: 'UPSERT',
      ResourceRecordSet: {
        Name: 'test.plasmic.run',
        Type: 'CNAME',
        TTL: 300,
        ResourceRecords: [{
          Value: distribution.DomainName
        }]
      }
    }]
  }
}).promise();
```

## Testing Without AWS

If you don't have AWS set up yet, you can:

1. **Test HTML Generation**
   ```typescript
   // Comment out S3 upload in deploy.ts
   // Just log the generated HTML
   console.log(assets.pages[0].html);
   ```

2. **Save Locally**
   ```typescript
   // Instead of S3, save to local directory
   fs.writeFileSync('./test-deploy/index.html', page.html);
   ```

3. **View in Browser**
   ```bash
   open ./test-deploy/index.html
   ```

## Minimal Working Example

Here's the simplest deployment that actually works:

```typescript
// 1. Generate HTML
const html = await genLoaderHtmlBundle({
  projectId: "your-project-id",
  component: "Homepage",
  projectToken: "your-token",
  hydrate: true
});

// 2. Upload to S3
await s3.putObject({
  Bucket: 'my-bucket',
  Key: 'index.html',
  Body: html,
  ContentType: 'text/html',
  ACL: 'public-read'
}).promise();

// 3. Access at:
// http://my-bucket.s3-website-us-east-1.amazonaws.com/
```

## Current Limitations

1. **Only Homepage** - Need to implement proper page extraction
2. **No CDN** - Direct S3 access only
3. **No Custom Domains** - Just S3 URLs for now
4. **No DNS** - Manual configuration required
5. **No Deployment Tracking** - Not stored in database

## Benefits of Simple Approach

1. **Easy to Debug** - Can see exactly what's uploaded
2. **Quick Testing** - No complex infrastructure
3. **Low Cost** - Just S3 storage
4. **Incremental** - Can add features one by one

## Ready to Deploy?

If you have AWS credentials:
1. Create the S3 bucket
2. Run the test script
3. View your deployed site!

If not:
1. Focus on getting page extraction working
2. Test HTML generation locally
3. Set up AWS when ready
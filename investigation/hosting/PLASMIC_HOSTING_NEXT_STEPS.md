# Plasmic Hosting - Next Steps Implementation Guide

## Current Status ✅
1. All hosting API endpoints implemented and working
2. Frontend UI integrated and functional
3. Deployment architecture designed (SSG + SSR support)
4. Domain management working

## Immediate Next Steps (Priority Order)

### 1. 🔧 Implement Page Extraction from Bundle (HIGH PRIORITY)
The most critical missing piece is extracting pages from Plasmic bundles.

```typescript
// In deploy.ts - extractPagesFromBundle()
function extractPagesFromBundle(bundle: Bundle): Array<{ name: string; path?: string }> {
  const site = bundle.site;
  const pages = [];
  
  // Extract components that are pages
  for (const component of site.components) {
    if (component.type === 'page') {
      pages.push({
        name: component.name,
        path: component.pageMeta?.path || `/${component.name.toLowerCase()}`
      });
    }
  }
  
  return pages;
}
```

**Action**: Research the actual Plasmic bundle structure to implement this correctly.

### 2. 🏗️ Set Up AWS Infrastructure (HIGH PRIORITY)

#### S3 Bucket Setup
```bash
# Create S3 bucket for hosting
aws s3 mb s3://plasmic-hosting-sites --region us-east-1

# Enable static website hosting
aws s3 website s3://plasmic-hosting-sites \
  --index-document index.html \
  --error-document error.html

# Set bucket policy for CloudFront access
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontAccess",
    "Effect": "Allow",
    "Principal": {
      "Service": "cloudfront.amazonaws.com"
    },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::plasmic-hosting-sites/*"
  }]
}
```

#### CloudFront Distribution
```javascript
const params = {
  DistributionConfig: {
    CallerReference: Date.now().toString(),
    Origins: {
      Quantity: 1,
      Items: [{
        Id: 'S3-plasmic-hosting',
        DomainName: 'plasmic-hosting-sites.s3.amazonaws.com',
        S3OriginConfig: {
          OriginAccessIdentity: '' // Create OAI
        }
      }]
    },
    DefaultCacheBehavior: {
      TargetOriginId: 'S3-plasmic-hosting',
      ViewerProtocolPolicy: 'redirect-to-https',
      Compress: true,
      CachePolicyId: 'Managed-CachingOptimized'
    },
    Enabled: true
  }
};
```

#### Lambda for SSR
```bash
# Create Lambda execution role
aws iam create-role --role-name plasmic-ssr-role \
  --assume-role-policy-document file://lambda-trust-policy.json

# Deploy Lambda function
aws lambda create-function \
  --function-name plasmic-ssr-renderer \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/plasmic-ssr-role \
  --handler index.handler
```

### 3. 🔍 Implement Real DNS Checking (MEDIUM PRIORITY)

```typescript
// In deploy.ts
import { Resolver } from 'dns';
import { promisify } from 'util';

export async function checkDnsConfiguration(domain: string): Promise<boolean> {
  const resolver = new Resolver();
  const resolveCname = promisify(resolver.resolveCname).bind(resolver);
  const resolve4 = promisify(resolver.resolve4).bind(resolver);
  
  try {
    if (domain.endsWith('.plasmic.run')) {
      // Check CNAME for subdomains
      const cnames = await resolveCname(domain);
      return cnames.some(cname => cname.includes('cloudfront.net'));
    } else {
      // Check A records for custom domains
      const addresses = await resolve4(domain);
      // Check if IPs match CloudFront IPs
      return addresses.length > 0;
    }
  } catch (error) {
    return false;
  }
}
```

### 4. 📦 Create Deployment Package Script

Create a script to package and prepare deployments:

```typescript
// scripts/prepare-hosting-deployment.ts
async function prepareDeployment() {
  // 1. Install AWS SDK if not present
  await exec('npm install aws-sdk');
  
  // 2. Check AWS credentials
  const credentials = await checkAWSCredentials();
  if (!credentials.valid) {
    throw new Error('AWS credentials not configured');
  }
  
  // 3. Verify S3 bucket exists
  await verifyS3Bucket();
  
  // 4. Check CloudFront distribution
  await verifyCloudFront();
  
  console.log('✅ Hosting infrastructure ready');
}
```

### 5. 🧪 Create Integration Tests (MEDIUM PRIORITY)

```typescript
// test/hosting-integration.test.ts
describe('Hosting Deployment', () => {
  it('should deploy a simple project', async () => {
    const projectId = 'test-project';
    const domains = ['test.plasmic.run'];
    
    const result = await deployProjectToHosting(mgr, projectId, domains);
    
    expect(result.successfulDomains).toHaveLength(1);
    expect(result.failedDomains).toHaveLength(0);
    
    // Verify S3 objects created
    const s3Objects = await listS3Objects(projectId);
    expect(s3Objects).toContain('index.html');
  });
  
  it('should handle SSR pages', async () => {
    // Test SSR deployment
  });
});
```

### 6. 📊 Add Deployment Status Tracking

```typescript
// Create deployment status table
interface DeploymentStatus {
  id: string;
  projectId: string;
  status: 'pending' | 'building' | 'deploying' | 'live' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  domains: string[];
  logs: DeploymentLog[];
}

// Add status updates throughout deployment
async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus['status'],
  log?: string
) {
  // Update in database
  await db.updateDeploymentStatus(deploymentId, { status, log });
  
  // Send webhook if configured
  await sendDeploymentWebhook(deploymentId, status);
}
```

## Environment Setup Checklist

### Required Environment Variables
```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Plasmic Hosting Config
PLASMIC_HOSTING_BUCKET=plasmic-hosting-sites
PLASMIC_HOSTING_DISTRIBUTION=E1234567890
PLASMIC_LAMBDA_ROLE_ARN=arn:aws:iam::123456789012:role/plasmic-ssr-role

# Route53 (for plasmic.run domains)
PLASMIC_RUN_HOSTED_ZONE_ID=Z1234567890
```

### Required AWS Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::plasmic-hosting-sites/*",
        "arn:aws:s3:::plasmic-hosting-sites"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetDistribution",
        "cloudfront:UpdateDistribution"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:*:*:function:plasmic-ssr-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/*"
    }
  ]
}
```

## Testing Plan

### 1. Local Testing
```bash
# Set up local AWS credentials
aws configure

# Test deployment locally
NODE_ENV=development yarn test:hosting
```

### 2. Staging Environment
- Deploy to a staging AWS account first
- Use test.plasmic.run domain
- Verify all components work

### 3. Production Rollout
- Start with internal projects
- Monitor CloudWatch metrics
- Gradually enable for users

## Success Metrics

1. **Deployment Success Rate**: >99%
2. **Deployment Time**: <60 seconds for average project
3. **Page Load Time**: <1s for SSG, <2s for SSR
4. **Cache Hit Rate**: >90% for static content
5. **Lambda Cold Start**: <500ms p95

## Next Development Phase

After core functionality is working:

1. **Advanced Features**
   - Preview deployments
   - Branch deployments
   - A/B testing support
   - Edge functions

2. **Performance Optimizations**
   - Image optimization
   - Code splitting
   - Progressive enhancement
   - Service workers

3. **Developer Experience**
   - CLI deployment tool
   - GitHub Actions integration
   - Deployment notifications
   - Analytics dashboard
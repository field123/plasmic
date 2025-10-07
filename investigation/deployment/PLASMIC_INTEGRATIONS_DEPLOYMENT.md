# Plasmic Integrations Backend Deployment Guide

## Overview

The Plasmic Integrations Backend handles:
- CMS API endpoints (`/api/v1/cms/*`)
- Data source integrations (`/api/v1/server-data/*`)
- App authentication endpoints

This backend can be deployed separately from the main Plasmic studio for better security isolation and scalability.

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   CloudFront    │────▶│    ALB (HTTPS)      │────▶│  Target Groups   │
└─────────────────┘     └─────────────────────┘     └──────────────────┘
                                    │                         │
                                    │                         ├── Main App TG
                                    │                         │   └── /api/* (default)
                                    │                         │
                                    └─────────────────────────┼── Integrations TG
                                                              │   ├── /api/v1/cms/*
                                                              │   └── /api/v1/server-data/*
                                                              │
                                                              └── Codegen TG
                                                                  └── /api/v1/code/*
```

## Deployment Process

### 1. Prerequisites

- AWS account with ECS, ECR, and ALB already configured
- GitHub repository secrets configured:
  - `AWS_ACCOUNT`: Your AWS account ID
  - `AWS_ROLE`: IAM role for GitHub Actions OIDC
- Existing ECS cluster and ALB from main Plasmic deployment

### 2. Automatic Deployment

The deployment is handled by GitHub Actions in two workflows:

1. **Build and Push to ECR** (`build-and-deploy-to-ecr.yml`)
   - Builds the Docker image containing all Plasmic services
   - Pushes to ECR
   - Triggers on pushes to main branch

2. **Deploy Integrations Backend** (`deploy-integrations-to-ecs.yml`)
   - Automatically triggers after successful image build
   - Creates/updates infrastructure:
     - CloudWatch log group
     - ALB target group
     - Listener rules for routing
   - Deploys the integrations service to ECS

### 3. Manual Deployment

To manually trigger deployment:

1. Go to GitHub Actions
2. Select "Deploy Integrations Backend to ECS"
3. Click "Run workflow"
4. Optionally specify an image tag (defaults to 'latest')

### 4. Configuration

The integrations backend uses the same configuration as the main app but runs with a different entry point:

```javascript
// Entry point: src/wab/server/integrations-main.ts
CMD ["node", "-r", "esbuild-register", "src/wab/server/integrations-main.ts"]
```

#### Environment Variables (via AWS Secrets Manager)

- `DATABASE_URI`: PostgreSQL connection string
- `SESSION_SECRET`: Session encryption key
- `HOST`: Public hostname for the service

#### Task Definition

- CPU: 1024 (1 vCPU)
- Memory: 2048 MB
- Port: 3004

### 5. ALB Routing Rules

The ALB routes requests based on path patterns:

| Priority | Path Pattern | Target |
|----------|-------------|--------|
| 100 | `/api/v1/cms/*` | Integrations Backend |
| 101 | `/api/v1/server-data/*` | Integrations Backend |
| Default | `/*` | Main App |

### 6. Health Checks

- Health check endpoint: `/api/v1/cms/health`
- Interval: 30 seconds
- Timeout: 5 seconds
- Healthy threshold: 2 consecutive successes
- Unhealthy threshold: 3 consecutive failures

## Post-Deployment Steps

### 1. Update CMS Components

After deployment, update your CMS components to use your domain instead of `data.plasmic.app`:

```bash
# Update the default URL in CMS bundle before importing
npx tsx update-cms-default-url.ts https://your-domain.com
```

### 2. Verify Deployment

Test the endpoints:

```bash
# Test CMS endpoint
curl https://your-domain.com/api/v1/cms/databases

# Test data source endpoint  
curl https://your-domain.com/api/v1/server-data/sources
```

### 3. Monitor

- Check ECS service status in AWS Console
- Monitor CloudWatch logs: `/ecs/plasmic-integrations`
- Check ALB target group health

## Troubleshooting

### Service Won't Start

1. Check CloudWatch logs for errors
2. Verify secrets are properly configured in Secrets Manager
3. Ensure the database is accessible from ECS tasks

### 502 Bad Gateway

1. Check target group health status
2. Verify security group allows traffic on port 3004
3. Check if health check endpoint is responding

### Routing Issues

1. Verify ALB listener rules priorities
2. Check CloudFront behaviors if using CDN
3. Ensure path patterns match exactly

## Scaling

The service is configured with:
- Minimum tasks: 2
- Auto-scaling can be configured based on:
  - CPU utilization
  - Memory utilization
  - ALB request count

## Security Considerations

1. The integrations backend runs with `skipSession: true` for public API access
2. Authentication is handled via API tokens
3. Network isolation via security groups
4. Secrets stored in AWS Secrets Manager
5. HTTPS only via ALB

## Rollback

To rollback to a previous version:

1. Find the previous task definition revision
2. Update the service to use that revision:

```bash
aws ecs update-service \
  --cluster plasmic-test-cluster \
  --service plasmic-integrations-service \
  --task-definition plasmic-integrations:PREVIOUS_REVISION
```
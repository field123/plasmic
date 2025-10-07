# Plasmic Technical Strategy Document

## Executive Summary

Plasmic is an open-source visual web builder that can be self-hosted for complete control over your design and development infrastructure. This document outlines the technical strategy for deploying Plasmic within ElasticPath's infrastructure.

### Key Requirements

- **Architecture**: Microservices-based with 4 core backend services
- **Database**: PostgreSQL 15 with specific extensions
- **Storage**: S3-compatible object storage for assets and generated code
- **Compute**: Docker containers (adaptable to Kubernetes or ECS)
- **Domains**: Three public-facing domains for studio, codegen, and data APIs

### Critical Decision Points

1. **Multi-tenancy vs Isolation**: Platform supports both; choose based on security requirements
2. **Rendering Strategy**: Self-host both editor and runtime, or use Plasmic CDN for runtime
3. **Support Model**: Community support vs enterprise license with SLA
4. **Infrastructure**: AWS ECS (current) vs Kubernetes adaptation

### Expected Scale

- Supports hundreds of storefronts
- Horizontal scaling for all stateless services
- Worker thread pools for CPU-intensive operations
- CDN integration for global performance

## 1. Architecture Overview

### 1.1 Core Components

Plasmic uses a **microservices architecture** with specialized backend services:

#### Services Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Plasmic Platform                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐    ┌─────────────────┐          │
│  │  App Backend    │    │  Socket Backend  │          │
│  │  Port: 3003     │    │  Port: 3020      │          │
│  │  - Studio UI    │    │  - WebSockets    │          │
│  │  - Auth/Teams   │    │  - Collaboration │          │
│  │  - Projects     │    │  - Stateful      │          │
│  └────────┬────────┘    └──────────────────┘          │
│           │                                             │
│  ┌────────▼────────┐    ┌─────────────────┐          │
│  │ Codegen Backend │    │   Integrations   │          │
│  │  Port: 3008     │    │     Backend      │          │
│  │  - Code Gen     │    │   Port: 3004     │          │
│  │  - Loader API   │    │   - CMS API      │          │
│  │  - Bundles      │    │   - Data Sources │          │
│  └─────────────────┘    └─────────────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Service Descriptions

1. **Main App Backend** (`app-backend-real.ts`, port 3003):

   - Primary service handling Plasmic Studio UI
   - User authentication and team management
   - Project management and versioning
   - Routes all studio-related API calls
   - Proxies WebSocket connections to Socket Backend

2. **Socket Backend** (`app-socket-backend-real.ts`, port 3020):

   - **Stateful** WebSocket server (only stateful service)
   - Real-time collaboration features
   - Project-specific rooms for multi-user editing
   - Not directly exposed to public internet
   - Accessed via `/api/v1/socket` through main app proxy

3. **Codegen Backend** (`codegen-backend-real.ts`, port 3008):

   - Generates React/Vue/Angular components
   - Serves the loader API (`/api/v1/loader/*`)
   - Handles code bundling for runtime
   - Caches generated assets in S3
   - Public API for headless usage

4. **Integrations Backend** (`integrations-backend-real.ts`, port 3004):
   - CMS API operations (`/api/v1/cms/*`)
   - External data source integrations
   - App authentication (OAuth flows)
   - Stateless, token-only authentication
   - No browser sessions

### 1.2 Worker Architecture

Plasmic uses **thread-based workers** for CPU-intensive operations within the backend services:

#### Worker Pool Configuration

```typescript
// Two separate worker pools (platform/wab/src/wab/server/AppServer.ts)
const genericPool = workerpool.pool({
  maxWorkers: env.GENERIC_WORKER_POOL_SIZE || 1,
  workerType: "thread",
});

const loaderAssetsPool = workerpool.pool({
  maxWorkers: env.LOADER_WORKER_POOL_SIZE || 1,
  workerType: "thread",
});
```

#### Worker Types

1. **Codegen Worker** (`platform/wab/src/wab/server/workers/codegen.ts`):

   - Generates framework-specific code from projects
   - Processes image assets and CDN uploads
   - Creates component dependency graphs

2. **Loader Assets Builder** (`platform/wab/src/wab/server/workers/build-loader-assets.ts`):

   - Bundles JavaScript modules using esbuild/webpack
   - Optimizes code for different frameworks
   - Handles code splitting

3. **Localization Worker** (`platform/wab/src/wab/server/workers/localization.ts`):

   - Extracts translatable strings from projects
   - Generates i18n message catalogs

4. **CloudFront Prefill** (uses generic pool):
   - Pre-generates common configurations after publish
   - Warms CDN cache for better performance

### 1.3 Data Layer

#### Primary Database

- **PostgreSQL 15**
  - All project metadata, users, teams
  - CMS data storage
  - Extensions required: `uuid-ossp`
  - Connection pooling via TypeORM

#### Object Storage (S3-compatible)

- **Generated Assets**: Code bundles, optimized images
- **Cache Storage**: Build artifacts with MD5 checksums
- **Error Logs**: Failed build diagnostics
- **Bucket Structure**:
  ```
  plasmic-loader-assets/
    └── codegen/cb={version}/pid={projectId}/v={version}/
  plasmic-site-assets/
    └── images/{hash}.{ext}
  ```

#### Optional Components

- **Redis**: Session storage, caching
- **CDN**: CloudFront or compatible for asset delivery

## 2. Deployment Architecture

### 2.1 Container Strategy

#### Docker Configuration

- Multi-stage Dockerfile in `platform/wab/Dockerfile`
- Single image supports all services via different entry points
- Node.js 24-alpine base image
- Production-optimized builds

#### Container Services

```yaml
services:
  plasmic-app-backend:
    image: plasmic/wab
    command: node app-backend.js
    ports: ["3003:3003"]
    environment:
      - DATABASE_URI
      - SESSION_SECRET
      - SOCKET_HOST=plasmic-socket:3020

  plasmic-socket-backend:
    image: plasmic/wab
    command: node app-socket-backend.js
    ports: ["3020:3020"]
    environment:
      - DATABASE_URI

  plasmic-codegen-backend:
    image: plasmic/wab
    command: node codegen-backend.js
    ports: ["3008:3008"]
    environment:
      - DATABASE_URI
      - S3_BUCKET

  plasmic-integrations-backend:
    image: plasmic/wab
    command: node integrations-backend.js
    ports: ["3004:3004"]
    environment:
      - DATABASE_URI

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=plasmic
      - POSTGRES_USER=plasmic
```

### 2.2 Network Architecture

#### Domain Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        CloudFront CDN                           │
│                   plasmic.elasticpath.com                       │
├─────────────────────────────────────────────────────────────────┤
│  Static Assets (S3)          │  Dynamic Requests (ALB Origin)  │
│  - React App Bundle          │  - /api/* → App Backend         │
│  - CSS/JS/Images            │  - /api/v1/socket → Socket Backend (via proxy) │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Direct Service Access                         │
├─────────────────────────────────────────────────────────────────┤
│ codegen.plasmic.elasticpath.com → Codegen Backend (port 3008)  │
│ data.plasmic.elasticpath.com → Integrations Backend (port 3004)│
└─────────────────────────────────────────────────────────────────┘
```

#### Load Balancing Configuration

- **Application Load Balancer (ALB)**:
  - Target groups for each backend service
  - Health checks on service-specific endpoints
  - WebSocket support enabled for socket backend
  - Sticky sessions for socket connections

#### Security Zones

- **Public Zone**: CloudFront, ALB
- **Private Zone**: Backend services in private subnets
- **Data Zone**: RDS and ElastiCache in isolated subnets
- **Security Groups**: Restrict inter-service communication

### 2.3 Infrastructure Requirements

#### Compute Resources (Minimum Production)

| Service         | Instances | CPU    | Memory | Notes                           |
| --------------- | --------- | ------ | ------ | ------------------------------- |
| App Backend     | 2-4       | 2 vCPU | 4 GB   | Horizontal scaling              |
| Socket Backend  | 2         | 2 vCPU | 4 GB   | Stateful, needs sticky sessions |
| Codegen Backend | 2-3       | 4 vCPU | 8 GB   | CPU-intensive                   |
| Integrations    | 2-3       | 2 vCPU | 4 GB   | Horizontal scaling              |
| Worker Pools    | N/A       | Shared | Shared | Threads within services         |

#### Storage Requirements

- **PostgreSQL**: 100 GB SSD (start), 3000 IOPS
- **S3 Buckets**: 500 GB - 1 TB for assets
- **Backup Storage**: 2x primary storage

#### Network Requirements

- **Bandwidth**: 100 Mbps minimum, 1 Gbps recommended
- **CDN**: Global distribution recommended
- **Load Balancer**: Application Load Balancer with WebSocket support

## 3. Integration Strategy

### 3.1 Authentication & Authorization

#### SSO Integration

- **OIDC Support**: Built-in OpenID Connect
- **Tested Providers**: Okta (others compatible)
- **Configuration**: Per-team SSO settings
- **User Mapping**: External ID support

#### API Authentication

```typescript
// Multiple authentication levels
- Personal API tokens (user-level)
- Team API tokens (team-level)
- Project tokens (project-specific)
- CMS tokens (database-specific)
```

#### Authorization Model

- **Roles**: `owner` → `editor` → `designer` → `content` → `commenter` → `viewer`
- **Hierarchical**: Team → Workspace → Project permissions
- **API Scoping**: Token permissions limited by role

### 3.2 API Integration

#### REST API Endpoints

- **Studio API**: `/api/v1/*` - Project management, auth
- **Loader API**: `/api/v1/loader/*` - Component fetching
- **CMS API**: `/api/v1/cms/*` - Content management
- **Codegen API**: `/api/v1/code/*` - Code generation

#### Webhook Support

- Project publish events
- CMS content changes
- User activity notifications
- Custom headers and payloads

#### Rate Limiting

- Per-token rate limits
- Burst allowances
- Different limits per API type

### 3.3 Data Integration

#### CMS Options

1. **Built-in CMS**:

   - PostgreSQL-based
   - Table/row structure
   - API access via tokens

2. **External CMS Integration**:
   - Extensible data source system
   - OAuth-based authentication
   - Real-time sync capabilities

#### Data Sources

- REST API integration
- GraphQL support
- Database connections
- Custom data fetchers

## 4. Operational Considerations

### 4.1 Deployment Process

#### Blue-Green Deployment

```mermaid
graph LR
    A[Current Version] -->|100% traffic| B[Load Balancer]
    C[New Version] -->|0% traffic| B
    B --> D[Health Checks Pass]
    D -->|Switch traffic| E[New Version Live]
```

### 4.2 Monitoring & Observability

#### Key Metrics to Track

- **Service Health**: Response times, error rates
- **Worker Pools**: Queue depth, execution time
- **Database**: Connection pool usage, query performance
- **S3 Cache**: Hit/miss rates, storage growth

#### Monitoring Stack

- **Metrics**: Prometheus + Grafana
- **Logs**: ELK Stack or CloudWatch
- **Tracing**: OpenTelemetry support
- **Errors**: Sentry integration built-in

#### Alerting Strategy

- Service availability < 99%
- Worker pool saturation > 80%
- Database connections > 80%
- Error rate spike detection

### 4.3 Performance Tuning

#### Worker Pool Sizing

```bash
# Based on concurrent users
GENERIC_WORKER_POOL_SIZE = concurrent_designers * 0.5
LOADER_WORKER_POOL_SIZE = api_requests_per_second * 0.1
```

#### Database Optimization

- Connection pool: 20-100 per service
- Enable query logging in development
- Index optimization for common queries
- Vacuum and analyze schedules

#### Caching Strategy

- S3 cache for generated assets (permanent)
- Redis for session data (optional)
- CDN for static assets (recommended)
- Browser caching headers configured

### 4.4 Security Operations

#### Compliance Considerations

- **GDPR**: Soft delete support, data export APIs
- **SOC2**: Audit trails, access logging
- **PCI**: Separate payment data, no credit cards stored

## 5. Licensing & Support

### 5.1 AGPL v3 License Implications

**What this means**:

1. **Self-Hosting**: Unrestricted for internal use
2. **Modifications**: Must open-source if distributed
3. **Network Clause**: Triggered only if offering as service
4. **Your Applications**: NOT affected by AGPL

### 5.2 Support Options

#### Community Support

- GitHub repository and issues
- Community forums
- Public documentation

#### Enterprise Support

- Priority bug fixes
- Direct support channel
- Custom feature development
- SLA guarantees (99.9% typical)
- Migration assistance

#### Commercial License

- Removes AGPL obligations
- Proprietary modifications allowed
- Typically bundled with support

## 6. Migration Strategy

### 6.1 Phased Implementation

#### Phase 1: Proof of Concept

- [ ] Deploy single-instance setup
- [ ] Import sample projects
- [ ] Test basic workflows
- [ ] Validate integrations

#### Phase 2: Pilot Program

- [ ] Multi-service deployment
- [ ] SSO integration
- [ ] First real projects
- [ ] Performance testing

#### Phase 3: Production Rollout

- [ ] High availability setup
- [ ] Full monitoring stack
- [ ] Team onboarding

### 6.2 Data Migration

#### From Plasmic SaaS

1. Export projects via API
2. Import to self-hosted instance
3. Update project references

## 7. Cost Analysis

### 7.1 Infrastructure Costs (AWS Estimated)

| Component                | Monthly Cost | Annual Cost |
| ------------------------ | ------------ | ----------- |
| ECS Fargate (4 services) | ?            | ?           |
| RDS PostgreSQL           | ?            | ?           |
| S3 Storage (1TB)         | ?            | ?           |
| CloudFront CDN           | ?            | ?           |
| Load Balancer            | ?            | ?           |

### 7.2 Operational Costs

#### Staffing Requirements

- DevOps Engineer
- Support

#### Additional Costs

- Enterprise support (optional): Contact Plasmic

## 8. Appendices

### 8.1 Environment Variables Reference

#### Required Variables

```bash
NODE_ENV=production
HOST=https://plasmic.elasticpath.com
DATABASE_URI=postgresql://user:pass@host:5432/plasmic
SESSION_SECRET=<random-string>
```

#### Service-Specific

```bash
# Socket Backend
SOCKET_HOST=plasmic-socket:3020
SOCKET_PORT=3020

# Codegen Backend
CODEGEN_ORIGIN=https://codegen.plasmic.elasticpath.com
LOADER_ASSETS_BUCKET=plasmic-loader-assets

# Integrations Backend
INTEGRATIONS_ORIGIN=https://data.plasmic.elasticpath.com

# Worker Pools
GENERIC_WORKER_POOL_SIZE=4
LOADER_WORKER_POOL_SIZE=4
WORKER_TIMEOUT=360000
```

### 8.2 Glossary

- **WAB**: Web Application Builder (Plasmic Studio)
- **Loader**: Runtime component loading system
- **Bundle**: Compiled component package
- **Project Revision**: Versioned state of a project
- **PkgVersion**: Published project version
- **Hostless**: Components without hosting requirements

---

# Elastic Path Authentication Integration - Implementation Plan

## Executive Summary

This document outlines a detailed implementation plan for integrating Elastic Path's authentication system with the self-hosted Plasmic instance. The plan follows a phased approach to minimize risk and ensure a smooth transition.

## Strategic Goals

1. **Single Sign-On (SSO)**: Enable Elastic Path users to access Plasmic Studio using their existing credentials
2. **API Integration**: Allow EP services to interact with Plasmic APIs using EP authentication tokens
3. **User Management**: Synchronize user data and permissions between systems
4. **Security**: Maintain enterprise-grade security throughout the integration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Elastic Path Auth System                      │
├─────────────────────────────────────────────────────────────────┤
│  - OIDC Provider Endpoints                                      │
│  - User Directory                                               │
│  - Token Management                                             │
│  - Permission System                                            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ OIDC/API
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    Auth Integration Layer                        │
├─────────────────────────────────────────────────────────────────┤
│  - Token Validation Service                                     │
│  - User Mapping Service                                         │
│  - Permission Translation                                       │
│  - Session Management                                           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                      Plasmic Platform                           │
├─────────────────────────────────────────────────────────────────┤
│  - SSO Configuration (SsoConfig)                                │
│  - API Authentication Middleware                                │
│  - User/Team Management                                         │
│  - Project Access Control                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Claims and Scopes Definition

**Standard Claims:**

```json
{
  "sub": "user-uuid",
  "email": "user@elasticpath.com",
  "email_verified": true,
  "name": "User Name",
  "preferred_username": "username",
  "updated_at": 1234567890
}
```

**Custom Claims for Plasmic:**

```json
{
  "plasmic_role": "editor|designer|viewer",
  "organization_id": "ep-org-id",
  "teams": ["team1", "team2"],
  "permissions": ["create_project", "edit_components"]
}
```

### 2.3 Security Configuration

- [ ] TLS configuration for all endpoints
- [ ] Token signing keys (RS256 recommended)
- [ ] Token expiration policies
- [ ] Refresh token strategy
- [ ] PKCE support for additional security

## Phase 3: Plasmic SSO Integration (Week 5-6)

### 3.1 SSO Configuration Setup

**Database Configuration:**

```typescript
// SsoConfig entity setup
{
  teamId: "elastic-path-main-team",
  domains: ["elasticpath.com"],
  provider: "oidc",
  config: {
    issuer: "https://auth.elasticpath.com",
    clientId: "plasmic-production",
    clientSecret: "[encrypted]",
    scope: "openid email profile plasmic_claims",
    sessionDurationMinutes: 480 // 8 hours
  }
}
```

### 3.2 User Provisioning Logic

**Just-In-Time (JIT) Provisioning:**

1. User authenticates with EP
2. OIDC callback to Plasmic
3. Check if user exists
4. If not, create user with:
   - Email from claims
   - Name from claims
   - Role based on custom claims
   - Team assignment based on claims

### 3.3 Team Structure Design

**Proposed Structure:**

```
Elastic Path Organization
├── Design Team (Designers, Editors)
├── Development Team (Developers, Editors)
├── Marketing Team (Content, Viewers)
└── Admin Team (Owners, Admins)
```

## Phase 4: API Authentication Integration (Week 7-8)

### 4.1 Token Validation Service

**Architecture:**

```typescript
// Middleware for EP token validation
interface EPTokenValidator {
  validateToken(token: string): Promise<EPUser>;
  exchangeForPlasmicToken(epUser: EPUser): Promise<string>;
  refreshToken(token: string): Promise<string>;
}
```

### 4.2 API Gateway Configuration

**Request Flow:**

1. Client sends request with EP token
2. API gateway validates EP token
3. Exchange for Plasmic session/token
4. Forward request to Plasmic APIs
5. Return response to client

### 4.3 Permission Mapping

**EP Permissions → Plasmic Roles:**

```
ep:admin          → plasmic:owner
ep:developer      → plasmic:editor
ep:designer       → plasmic:designer
ep:content_editor → plasmic:content
ep:viewer         → plasmic:viewer
```

## Phase 5: Testing & Validation (Week 9-10)

### 5.1 Integration Testing

**Test Scenarios:**

- [ ] SSO login flow (happy path)
- [ ] SSO login with invalid credentials
- [ ] Token expiration and refresh
- [ ] User provisioning for new users
- [ ] Permission enforcement
- [ ] API authentication flow
- [ ] Session management
- [ ] Logout flow
- [ ] Error scenarios

### 5.2 Performance Testing

**Benchmarks:**

- Authentication response time < 500ms
- Token validation < 100ms
- User provisioning < 2s
- Concurrent user support (target number)

### 5.3 Security Testing

- [ ] Penetration testing
- [ ] Token security validation
- [ ] Session hijacking prevention
- [ ] CSRF protection verification
- [ ] XSS prevention testing

## Phase 6: Migration & Rollout (Week 11-12)

### 6.1 Migration Strategy

**For Existing Users:**

1. Identify existing Plasmic users
2. Map to EP users by email
3. Create migration scripts
4. Plan cutover strategy
5. Communicate changes

**Rollout Phases:**

1. Internal IT team testing
2. Pilot group (5-10 users)
3. Department rollout
4. Full organization

### 6.2 Rollback Plan

**Contingencies:**

- Keep local auth active during transition
- Backup user data before migration
- Document rollback procedures
- Test rollback process

## Phase 7: Production Deployment (Week 13-14)

### 7.1 Deployment Checklist

**Pre-deployment:**

- [ ] Security review completed
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Support team trained
- [ ] Monitoring configured

**Deployment:**

- [ ] Deploy OIDC provider updates
- [ ] Configure Plasmic SSO
- [ ] Enable API authentication
- [ ] Verify health checks
- [ ] Monitor error rates

### 7.2 Post-Deployment

- [ ] Monitor authentication metrics
- [ ] Gather user feedback
- [ ] Address issues
- [ ] Optimize performance
- [ ] Document lessons learned

## Risk Assessment & Mitigation

### High-Risk Areas

1. **Authentication Downtime**

   - Mitigation: Implement failover to local auth
   - Backup: Maintain emergency access accounts

2. **Permission Misalignment**

   - Mitigation: Extensive testing of permission mappings
   - Backup: Manual permission override capability

3. **Token Security**

   - Mitigation: Short token lifetimes, encrypted storage
   - Backup: Token revocation mechanism

4. **User Experience Disruption**
   - Mitigation: Phased rollout, clear communication
   - Backup: Support documentation and training

## Success Metrics

### Technical Metrics

- Authentication success rate > 99.9%
- Response time < 500ms (p95)
- Zero security incidents
- API compatibility maintained

### Business Metrics

- User adoption rate > 95%
- Support ticket reduction
- Time to access reduced by 50%
- Improved security posture

## Resource Requirements

### Team Composition

- 1 Technical Lead
- 2 Backend Engineers (EP auth system)
- 1 Backend Engineer (Plasmic integration)
- 1 DevOps Engineer
- 1 Security Engineer
- 1 QA Engineer
- 1 Technical Writer

### Infrastructure

- OIDC provider infrastructure
- Token validation service
- Monitoring and logging
- Load balancing for auth endpoints

## Timeline Summary

- **Weeks 1-2**: Discovery & Requirements
- **Weeks 3-4**: OIDC Provider Setup
- **Weeks 5-6**: Plasmic Integration
- **Weeks 7-8**: API Authentication
- **Weeks 9-10**: Testing
- **Weeks 11-12**: Migration
- **Weeks 13-14**: Production Deployment

## Next Steps

1. **Approval**: Get stakeholder approval for the plan
2. **Team Assembly**: Assign resources to the project
3. **Kickoff**: Schedule project kickoff meeting
4. **Discovery**: Begin technical discovery phase
5. **Regular Reviews**: Set up weekly progress reviews

## Appendix: Technical References

### Plasmic Authentication Files

- `/platform/wab/src/wab/server/auth/` - Auth implementation
- `/platform/wab/src/wab/server/entities/` - User/auth entities
- `/platform/wab/src/wab/server/routes/auth.ts` - Auth routes

### Standards & Specifications

- OpenID Connect Core 1.0
- OAuth 2.0 (RFC 6749)
- JWT (RFC 7519)
- PKCE (RFC 7636)

### Security Best Practices

- OWASP Authentication Cheat Sheet
- NIST 800-63B Authentication Guidelines

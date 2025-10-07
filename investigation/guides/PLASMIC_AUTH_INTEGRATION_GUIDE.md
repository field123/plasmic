# Plasmic Authentication Integration Guide for Elastic Path

## Executive Summary

This document outlines strategies for integrating Elastic Path's authentication system with a self-hosted Plasmic instance. Based on the analysis of Plasmic's authentication architecture, there are multiple viable integration approaches ranging from simple SSO integration to complete authentication replacement.

## Current Plasmic Authentication Architecture

### Core Components

1. **Multiple Authentication Methods**
   - Local email/password authentication
   - OAuth providers (Google)
   - SSO/OIDC for enterprise teams
   - API token authentication

2. **Session Management**
   - Cookie-based sessions stored in PostgreSQL
   - 30-day default expiration
   - CSRF protection enabled

3. **Database Models**
   - User entity with bcrypt passwords
   - OauthToken for OAuth providers
   - Various API token types (personal, team, project)
   - SsoConfig for enterprise SSO

## Integration Approaches

### Option 1: SSO/OIDC Integration (Recommended)

**Overview**: Use Plasmic's built-in SSO support to integrate with Elastic Path's authentication system.

**Implementation Steps**:

1. **Set up Elastic Path as OIDC Provider**
   ```typescript
   // Configure in SsoConfig entity
   {
     teamId: "elastic-path-team-id",
     domains: ["elasticpath.com"],
     provider: "oidc",
     config: {
       issuer: "https://auth.elasticpath.com",
       clientId: "plasmic-client-id",
       clientSecret: "plasmic-client-secret",
       authorizationUrl: "https://auth.elasticpath.com/oauth/authorize",
       tokenUrl: "https://auth.elasticpath.com/oauth/token",
       userInfoUrl: "https://auth.elasticpath.com/oauth/userinfo"
     }
   }
   ```

2. **Domain-based Routing**
   - Users with @elasticpath.com emails automatically use SSO
   - Seamless experience for Elastic Path users

3. **User Provisioning**
   - Automatic user creation on first SSO login
   - Team membership assignment based on OIDC claims

**Pros**:
- Minimal code changes required
- Leverages existing Plasmic infrastructure
- Maintains compatibility with Plasmic updates
- Enterprise-ready solution

**Cons**:
- Requires Elastic Path to expose OIDC endpoints
- Limited customization of authentication flow

### Option 2: Custom Passport Strategy

**Overview**: Implement a custom Passport.js strategy to authenticate against Elastic Path's system.

**Implementation**:

1. **Create Custom Strategy** (`platform/wab/src/wab/server/auth/custom-passport-cfg.ts`):
   ```typescript
   import { Strategy as CustomStrategy } from 'passport-custom';
   
   export const elasticPathStrategy = new CustomStrategy(
     async (req, done) => {
       try {
         // Validate credentials against Elastic Path API
         const { email, password } = req.body;
         const epUser = await validateWithElasticPath(email, password);
         
         if (epUser) {
           // Create or update Plasmic user
           const user = await findOrCreateUser(epUser);
           return done(null, user);
         }
         
         return done(null, false);
       } catch (err) {
         return done(err);
       }
     }
   );
   ```

2. **Configure Authentication Routes**:
   ```typescript
   // In auth/routes.ts
   router.post('/auth/elastic-path', 
     passport.authenticate('elastic-path'),
     (req, res) => {
       res.json({ success: true, user: req.user });
     }
   );
   ```

**Pros**:
- Direct integration with Elastic Path auth
- Full control over authentication flow
- Can maintain existing Plasmic auth alongside

**Cons**:
- More complex implementation
- Requires maintaining custom code

### Option 3: API Token Bridge

**Overview**: Use Plasmic's API token system with Elastic Path authentication as a gateway.

**Implementation**:

1. **Authentication Service**:
   ```typescript
   // Create middleware to validate EP tokens
   export async function elasticPathAuthMiddleware(req, res, next) {
     const epToken = req.headers['x-elastic-path-token'];
     
     if (epToken) {
       const epUser = await validateElasticPathToken(epToken);
       if (epUser) {
         // Get or create corresponding Plasmic API token
         const plasmicToken = await getOrCreatePlasmicToken(epUser);
         req.headers['x-plasmic-api-token'] = plasmicToken;
         req.headers['x-plasmic-api-user'] = epUser.email;
       }
     }
     
     next();
   }
   ```

2. **Token Synchronization**:
   - Map Elastic Path users to Plasmic users
   - Generate Plasmic API tokens for EP authenticated users
   - Handle token lifecycle management

**Pros**:
- Works with existing API authentication
- No changes to Plasmic core auth
- Good for API-first approach

**Cons**:
- Doesn't provide Studio session auth
- Requires token management service

### Option 4: Complete Authentication Replacement

**Overview**: Replace Plasmic's authentication system entirely with Elastic Path's system.

**Implementation Areas**:

1. **Replace User Model**:
   ```typescript
   // Modify User entity to reference EP users
   @Entity()
   export class User {
     @Column()
     elasticPathUserId: string;
     
     // Remove password field
     // Add EP-specific fields
   }
   ```

2. **Session Management**:
   - Replace Express sessions with EP session validation
   - Implement EP token validation in middleware

3. **API Authentication**:
   - Redirect all auth checks to EP system
   - Maintain API token compatibility

**Pros**:
- Complete control over authentication
- Single source of truth for users
- No duplicate user management

**Cons**:
- Major code changes required
- Breaks compatibility with upstream
- Maintenance burden for updates

## Recommended Approach: Hybrid SSO + API Integration

Based on the analysis, the recommended approach combines SSO for Studio access with API integration for programmatic access:

### Phase 1: SSO Integration
1. Configure Elastic Path as OIDC provider
2. Set up team with elasticpath.com domain
3. Enable automatic user provisioning
4. Test with pilot users

### Phase 2: API Enhancement
1. Implement EP token validation middleware
2. Create token exchange service
3. Map EP permissions to Plasmic roles
4. Enable for API/CLI access

### Phase 3: Custom Extensions
1. Add EP-specific user attributes
2. Implement custom permission checks
3. Integrate with EP organizations/teams
4. Add audit logging

## Implementation Checklist

### Prerequisites
- [ ] Elastic Path OIDC endpoints available
- [ ] Client credentials for Plasmic
- [ ] User attribute mapping defined
- [ ] Permission model mapped

### Configuration Steps
- [ ] Create SsoConfig for Elastic Path
- [ ] Configure domain routing
- [ ] Set up user provisioning rules
- [ ] Test authentication flow

### Integration Points
- [ ] Studio login via SSO
- [ ] API authentication with EP tokens
- [ ] User profile synchronization
- [ ] Permission synchronization

### Testing
- [ ] SSO login flow
- [ ] User provisioning
- [ ] API token validation
- [ ] Permission enforcement
- [ ] Session management

## Security Considerations

1. **Token Security**
   - Encrypt stored tokens
   - Implement token rotation
   - Set appropriate expiration

2. **Session Security**
   - Maintain CSRF protection
   - Implement session timeout
   - Secure cookie settings

3. **Audit Trail**
   - Log authentication events
   - Track permission changes
   - Monitor failed attempts

## Migration Strategy

### For Existing Users
1. Map existing Plasmic users to EP users
2. Migrate permissions and projects
3. Provide transition period with dual auth
4. Deprecate local passwords

### For New Users
1. Enforce EP authentication only
2. Automatic provisioning via SSO
3. No local password creation

## Maintenance Considerations

1. **Updates from Upstream**
   - Monitor Plasmic auth changes
   - Maintain compatibility layer
   - Document customizations

2. **EP System Changes**
   - Handle API version changes
   - Update token validation
   - Maintain user mapping

## Conclusion

The SSO-based integration provides the best balance of functionality, security, and maintainability. It leverages Plasmic's existing enterprise authentication infrastructure while allowing Elastic Path to maintain control over user authentication. The phased approach allows for gradual implementation and testing without disrupting existing workflows.
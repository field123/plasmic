# Appendix: Plasmic Management API Endpoints

## Overview

This appendix provides the essential API endpoints for programmatic provisioning of Plasmic resources as part of the Elastic Path integration.

## Authentication

```bash
# Team API Token (recommended for provisioning)
curl -H "x-plasmic-api-user: TEAM_TOKEN" \
     -X POST https://studio.plasmic.app/api/v1/teams

# User API Token
curl -H "x-plasmic-api-user: USER_TOKEN" \
     -X GET https://studio.plasmic.app/api/v1/projects
```

## Core Provisioning Endpoints

### Teams (EP Organization → Plasmic Team)

- `POST /api/v1/teams` - Create team
- `GET /api/v1/teams/:teamId` - Get team details
- `PUT /api/v1/teams/:teamId` - Update team

### Workspaces (EP Store → Plasmic Workspace)

- `POST /api/v1/workspaces` - Create workspace
- `GET /api/v1/workspaces/:workspaceId` - Get workspace
- `GET /api/v1/teams/:teamId/workspaces` - List team workspaces

### Projects

- `POST /api/v1/projects` - Create project
- `GET /api/v1/projects?workspaceId=wsId` - List workspace projects

## Permission Management

### Grant/Revoke Access

```http
POST /api/v1/grant-revoke
{
  "grants": [{
    "email": "user@elasticpath.com",
    "accessLevel": "editor",  // viewer|content|designer|editor|owner
    "teamId": "team123"       // or workspaceId, projectId
  }],
  "revokes": [{
    "email": "user@elasticpath.com",
    "teamId": "team123"
  }]
}
```

### Access Level Mapping

| Elastic Path Role   | Plasmic Access Level |
| ------------------- | -------------------- |
| `ep:admin`          | `owner`              |
| `ep:developer`      | `editor`             |
| `ep:designer`       | `designer`           |
| `ep:content_editor` | `content`            |
| `ep:viewer`         | `viewer`             |

** ep roles are not reflective of real ep roles **

## Webhook Integration

For real-time synchronization, implement webhooks:

- EP User Role Change → `POST /api/v1/grant-revoke`
- EP Organization Created → `POST /api/v1/teams`
- EP Store Created → `POST /api/v1/workspaces`
- EP User Deactivated → `POST /api/v1/grant-revoke` (revoke)

## Additional Endpoints

### User Management

- `GET /api/v1/users/:userIds` - Get user details
- `GET /api/v1/auth/self` - Current user info

### Team Administration

- `GET /api/v1/teams/:teamId/meta` - Team statistics
- `POST /api/v1/teams/:teamId/tokens` - Create API token
- `POST /api/v1/teams/purgeUsers` - Bulk remove users

### Monitoring

- Check team member count: `GET /api/v1/teams/:teamId/meta`
- List team projects: `GET /api/v1/teams/:teamId/projects`
- Audit permissions: Query permissions table directly

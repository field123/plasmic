# Elastic Path to Plasmic Entity Mapping Report

## Executive Summary

This report outlines the recommended approach for mapping Elastic Path's organizational structure (Organizations, Stores, and Users) to Plasmic's entity model (Teams, Workspaces, and Users). The proposed mapping enables seamless integration while maintaining the flexibility of Elastic Path's multi-tenant architecture.

## Entity Relationship Overview

### Elastic Path Model

```mermaid
graph TB
    subgraph "Elastic Path Entities"
        O[Organization] -->|1 to many| S[Store]
        U[User] -.->|many to many| O
        U -.->|many to many| S
        U -->|has| OR[Org Role]
        U -->|has| SR[Store Role]
    end

    style O fill:#e1f5fe
    style S fill:#fff9c4
    style U fill:#f3e5f5
```

### Plasmic Model Mapping

```mermaid
graph TB
    subgraph "Plasmic Actual Hierarchy"
        T[Team - Top Level] -->|1 to many| W[Workspace]
        T -->|legacy: can contain| P[Project]
        W -->|1 to many| P
        U[User] -.->|many to many| T
        U -.->|many to many| W
        U -->|has| TP[Team Permission]
        U -->|has| WP[Workspace Permission]
    end

    subgraph "Mapping"
        O2[EP Organization] ==>|maps to| T
        S2[EP Store] ==>|maps to| W
        U2[EP User] ==>|maps to| U
    end

    style T fill:#e1f5fe
    style W fill:#fff9c4
    style U fill:#f3e5f5
    style P fill:#f0f0f0
```

**Critical Understanding: "Organizations" in Plasmic UI = Teams in Backend**

While Plasmic's codebase contains a legacy `Org` entity, the term "Organization" you see in the Plasmic UI actually refers to the `Team` entity:

- **UI shows**: "Organization", "Manage Organization", `/orgs/:id` routes
- **Backend uses**: `Team` entity, `teams` table, Team-based logic
- **Why**: This is a labeling decision - Teams are presented as "Organizations" to users

The actual `Org` entity in the database is **completely unused**. When users interact with "Organizations" in Plasmic, they are actually working with Teams.

**For integration purposes**:

- When Plasmic documentation or UI mentions "Organization" → it means `Team` entity
- When mapping from Elastic Path → use EP Organization → Plasmic Team

## Detailed Entity Mapping

### Core Mappings

| Elastic Path Entity | Plasmic Entity       | Notes                               |
| ------------------- | -------------------- | ----------------------------------- |
| Organization        | Team                 | One-to-one mapping                  |
| Store               | Workspace            | Optional - only created when needed |
| User                | User                 | Shared across organizations         |
| Org Role            | Team Permission      | Role-based access at org level      |
| Store Role          | Workspace Permission | Store-specific access overrides     |

**Note on Enterprise Hierarchies**: For complex organizational structures, Plasmic supports parent-child Team relationships. This allows creating team hierarchies like:

- Parent Team: "ACME Corp Global"
  - Child Team: "ACME Corp US"
  - Child Team: "ACME Corp EU"

This can be useful if Elastic Path has regional or divisional organization structures.

### Permission Mapping

| EP Role   | Team Permission | Workspace Permission | Description             |
| --------- | --------------- | -------------------- | ----------------------- |
| Admin     | Owner           | Owner                | Full control            |
| Developer | Editor          | Editor               | Can modify designs      |
| Content   | -               | Content              | Content management only |
| Viewer    | Viewer          | Viewer               | Read-only access        |

## Architecture Flow

### Authentication & Provisioning Flow

```mermaid
sequenceDiagram
    participant U as User
    participant EP as EP Auth
    participant PM as Plasmic Middleware
    participant PDB as Plasmic DB
    participant EPAPI as EP API

    U->>EP: Login to Elastic Path
    EP->>U: Set cookie on .elasticpath.com
    U->>PM: Access plasmic.elasticpath.com
    PM->>PM: Check for EP cookie
    PM->>EPAPI: Validate token & get user access
    EPAPI->>PM: User data + org/store access

    alt User doesn't exist in Plasmic
        PM->>PDB: Create user
        PM->>PDB: Create/find teams (orgs)
        PM->>PDB: Create/find workspaces (stores)
        PM->>PDB: Grant permissions
    else User exists
        PM->>PDB: Sync user data
        PM->>PDB: Update permissions
    end

    PM->>U: Authenticated session
```

### Permission Inheritance Model

```mermaid
graph TD
    subgraph "Permission Resolution"
        A[User requests access] --> B{Has Store Role?}
        B -->|Yes| C[Use Store Role]
        B -->|No| D{Has Org Role?}
        D -->|Yes| E[Use Org Role]
        D -->|No| F[Default: Viewer]

        C --> G[Apply Permission]
        E --> G
        F --> G
    end
```

## Implementation Architecture

### Component Overview

```mermaid
graph LR
    subgraph "Elastic Path"
        EPA[Auth Service]
        EPO[Org Service]
        EPS[Store Service]
    end

    subgraph "Integration Layer"
        VAL[Validation Endpoint]
        PROV[Provisioning Service]
        SYNC[Sync Service]
    end

    subgraph "Plasmic"
        AUTH[Auth Middleware]
        TM[Team Manager]
        WM[Workspace Manager]
        PM[Permission Manager]
    end

    EPA --> VALC
    EPO --> PROV
    EPS --> PROV
    VAL --> AUTH
    PROV --> TM
    PROV --> WM
    SYNC --> PM
```

## Data Synchronization Strategy

### Initial Provisioning

```mermaid
flowchart TD
    A[EP User Login] --> B[Fetch User Data]
    B --> C[Fetch Org Access]
    C --> D[Fetch Store Access]

    D --> E{User Exists?}
    E -->|No| F[Create User]
    E -->|Yes| G[Update User]

    F --> H[Process Each Org]
    G --> H

    H --> I{Team Exists?}
    I -->|No| J[Create Team]
    I -->|Yes| K[Get Team]

    J --> L[Grant Team Permission]
    K --> L

    L --> M[Process Each Store]
    M --> N{Needs Workspace?}
    N -->|Yes| O{Workspace Exists?}
    N -->|No| P[Skip Store]

    O -->|No| Q[Create Workspace]
    O -->|Yes| R[Get Workspace]

    Q --> S[Grant Workspace Permission]
    R --> S
```

### Ongoing Synchronization

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> CheckingAuth: User Access

    CheckingAuth --> ValidatingToken: Has EP Token
    CheckingAuth --> RequireLogin: No Token

    ValidatingToken --> FetchingData: Valid Token
    ValidatingToken --> RequireLogin: Invalid Token

    FetchingData --> SyncingUser: Get EP Data
    SyncingUser --> SyncingPerms: Update User Info
    SyncingPerms --> SyncingTeams: Update Permissions
    SyncingTeams --> SyncingWorkspaces: Sync Teams
    SyncingWorkspaces --> Authenticated: Sync Workspaces

    Authenticated --> [*]
    RequireLogin --> [*]
```

## Key Features

### 1. Multi-Organization Support

Users can belong to multiple organizations with different roles:

```mermaid
graph TD
    U[John Doe] --> O1[ACME Corp<br/>Role: Admin]
    U --> O2[Beta Inc<br/>Role: Developer]
    U --> O3[Gamma LLC<br/>Role: Viewer]

    O1 --> S1[US Store]
    O1 --> S2[EU Store]
    O2 --> S3[Test Store]
    O3 --> S4[Demo Store]

    style U fill:#f3e5f5
    style O1,O2,O3 fill:#e1f5fe
    style S1,S2,S3,S4 fill:#fff9c4
```

### 2. Store-Level Workspace Creation

Not all stores require Plasmic workspaces. They are created on-demand:

```mermaid
flowchart LR
    A[Store Created] --> B{Needs Design?}
    B -->|Yes| C[Request Workspace]
    B -->|No| D[No Workspace]

    C --> E{User Authorized?}
    E -->|Yes| F[Create Workspace]
    E -->|No| G[Deny Request]

    F --> H[Workspace Ready]
```

### 3. Permission Cascading

Organization-level permissions cascade to stores unless overridden:

```mermaid
graph TD
    subgraph "Organization Level"
        O[ACME Corp] --> UA[User A: Admin]
        O --> UB[User B: Developer]
    end

    subgraph "Store Level"
        S1[US Store] --> UA1[User A: Inherited Admin]
        S1 --> UB1[User B: Content Editor<br/>*Override*]

        S2[EU Store] --> UA2[User A: Inherited Admin]
        S2 --> UB2[User B: Inherited Developer]
    end

    UA -.->|inherits| UA1
    UA -.->|inherits| UA2
    UB -.->|override| UB1
    UB -.->|inherits| UB2

    style UB1 fill:#ffcccc
```

## Implementation Recommendations

### Phase 1: Foundation (Weeks 1-2)

- Set up shared domain cookies
- Implement validation endpoint
- Create basic provisioning logic

### Phase 2: Entity Mapping (Weeks 3-4)

- Implement organization → team mapping
- Implement store → workspace mapping
- Set up permission mapping

### Phase 3: Advanced Features (Weeks 5-6)

- On-demand workspace creation
- Permission inheritance logic
- Cross-store collaboration

### Phase 4: Optimization (Weeks 7-8)

- Caching strategies
- Bulk synchronization
- Performance tuning

## Security Considerations

### Token Flow Security

```mermaid
flowchart LR
    A[EP Cookie<br/>.elasticpath.com] -->|HTTPS Only| B[Validation API]
    B -->|Server-to-Server| C[Token Verification]
    C -->|Encrypted Response| D[User Data]
    D -->|Create Session| E[Plasmic Cookie<br/>plasmic.elasticpath.com]

    style A fill:#ffcccc
    style E fill:#ccffcc
```

### Data Privacy

- User data synchronized only as needed
- Minimal data storage in Plasmic
- Audit trail for all provisioning events
- Encrypted storage of external IDs

## Benefits of This Approach

1. **Seamless SSO**: Users authenticate once with Elastic Path
2. **Flexible Structure**: Supports complex organizational hierarchies
3. **Granular Permissions**: Store-level overrides when needed
4. **Scalable**: Handles users with multiple organization memberships
5. **On-Demand Resources**: Workspaces created only when needed
6. **Maintainable**: Clear separation of concerns

## Potential Challenges & Mitigations

| Challenge           | Impact                           | Mitigation                     |
| ------------------- | -------------------------------- | ------------------------------ |
| Permission Sync Lag | Users may have stale permissions | Implement real-time webhooks   |
| Complex Hierarchies | Difficult to visualize           | Custom UI for EP structure     |
| Store Proliferation | Too many workspaces              | Workspace archiving strategy   |
| Cross-Org Isolation | No sharing between orgs          | Intentional - security feature |

## Conclusion

The proposed entity mapping provides a robust foundation for integrating Elastic Path's multi-tenant commerce platform with Plasmic's visual design system. The architecture maintains the flexibility of both systems while providing a seamless user experience and appropriate security boundaries.

Key success factors:

- Automatic user provisioning reduces friction
- Permission inheritance simplifies management
- On-demand workspace creation optimizes resources
- Clear entity mapping ensures consistency

This approach scales from small single-store merchants to large multi-national organizations with complex permission requirements.

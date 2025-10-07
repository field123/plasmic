# Plasmic AI/Copilot Architecture Document

## Executive Summary

This document describes the AI/Copilot features architecture within Plasmic, detailing how these capabilities enhance the visual web builder with AI-powered assistance. The implementation consists of both open-source components and proprietary additions that enable UI generation, code assistance, and intelligent design suggestions.

## 1. Architecture Overview

### 1.1 Copilot Services Architecture

The AI/Copilot functionality is implemented as a separate microservice that integrates with the existing Plasmic architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Plasmic AI Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                   │
│  │  Plasmic Studio │    │ Copilot Backend  │                   │
│  │  (Frontend)     │───▶│  Port: 3004      │                   │
│  │                 │    │  - UI Generation │                   │
│  │  Features:      │    │  - Code Gen      │                   │
│  │  - Generate UI  │    │  - SQL Queries   │                   │
│  │  - AI Chat      │    │  - Debug Help    │                   │
│  └─────────────────┘    └────────┬─────────┘                   │
│                                  │                              │
│                         ┌────────▼─────────┐                    │
│                         │   LLM Providers  │                    │
│                         │  - OpenAI (GPT)  │                    │
│                         │  - Anthropic     │                    │
│                         │    (Claude)      │                    │
│                         └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Feature Categories

#### 1.2.1 UI Generation Copilot
- **Purpose**: Generate UI components from natural language descriptions
- **Access**: "Generate UI" button in Plasmic Studio top bar
- **Models**: GPT-3.5-turbo (public), GPT-4 (authenticated users)

#### 1.2.2 Code Copilot
- **Purpose**: Generate and modify code within the Plasmic editor
- **Types**: JavaScript expressions, SQL queries, debug assistance
- **Integration**: Direct integration with code editors in Plasmic

#### 1.2.3 Chat Interface
- **Purpose**: General assistance and guidance
- **Context**: Project-aware responses

## 2. Implementation Details

### 2.1 Backend Service Architecture

#### Copilot Backend Service (`copilot-backend-real.ts`)
```typescript
// New service running on port 3004
// Handles all AI-related requests
// Stateless, horizontally scalable

Key endpoints:
- POST /api/v1/copilot - Main copilot queries
- POST /api/v1/copilot/ui - UI generation
- POST /api/v1/copilot/ui/public - Public UI generation (no auth)
- POST /api/v1/copilot-feedback - User feedback
- GET /api/v1/copilot-feedback - Query feedback (admin)
```

### 2.2 Custom Components Added

#### 2.2.1 LLM Integration Layer (`platform/wab/src/wab/server/copilot/llms.ts`)
```typescript
// Abstraction layer for multiple LLM providers
- OpenAI integration with GPT models
- Anthropic integration with Claude models
- Caching layer (DynamoDB or in-memory fallback)
- Request/response formatting
```

#### 2.2.2 UI Copilot Chain (`platform/wab/src/wab/server/copilot/ui-copilot-chain.ts`)
```typescript
// Specialized prompt engineering for UI generation
- HTML generation with inline styles
- Design token integration (CSS variables)
- Multi-section layout support
- Accessibility best practices
```

#### 2.2.3 Rate Limiting & Usage Tracking
```typescript
// Database-backed rate limiting
- Per-user/team quotas
- Usage tracking for billing
- Public endpoint protection
```

#### 2.2.4 Caching Strategy
```typescript
// Two-tier caching system
- DynamoDB for production (persistent)
- In-memory cache for development (15-min TTL)
- Content-based hashing for cache keys
```

### 2.3 Frontend Integration

#### 2.3.1 Studio UI Components
```typescript
// CopilotUiPrompt component
- Modal dialog for UI generation
- Image upload support
- Token context passing
- Real-time preview
```

#### 2.3.2 Feature Flags & Access Control
```typescript
// Multi-level access control
- DevFlags: showCopilot, enableUiCopilot
- Team tier checking (paid/trial)
- Admin domain overrides (@elasticpath.com)
```

## 3. Key Differentiators from Open Source

### 3.1 Proprietary Additions

1. **Copilot Backend Service**
   - Not included in open-source release
   - Separate microservice architecture
   - Custom prompt engineering

2. **LLM Provider Integration**
   - API key management
   - Provider abstraction layer
   - Cost optimization strategies

3. **Enterprise Features**
   - Rate limiting per organization
   - Usage analytics and billing
   - Custom model selection

4. **Advanced Prompt Engineering**
   - Plasmic-specific context understanding
   - Design token awareness
   - Framework-specific code generation

### 3.2 Configuration Requirements

#### Environment Variables (Not in Open Source)
```bash
# LLM Provider Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Caching Configuration
DYNAMODB_ACCESS_KEY_ID=...
DYNAMODB_SECRET_ACCESS_KEY=...

# Rate Limiting
COPILOT_RATE_LIMIT_REQUESTS=100
COPILOT_RATE_LIMIT_WINDOW=3600000
```

#### Secrets Configuration
```json
// ~/.plasmic/secrets.json
{
  "openaiApiKey": "sk-...",
  "anthropicApiKey": "sk-ant-...",
  "dynamodb": {
    "accessKeyId": "...",
    "secretAccessKey": "..."
  }
}
```

## 4. Integration with Core Platform

### 4.1 Authentication & Authorization

The copilot features integrate with Plasmic's existing auth system:

```typescript
// Access control hierarchy
1. Check user authentication
2. Verify team membership
3. Check feature flags (enableUiCopilot)
4. Validate team tier (paid/trial/admin)
5. Apply rate limits
```

### 4.2 Data Flow

```
User Request → Studio Frontend → Copilot Backend → LLM Provider
                                        ↓
                                   Cache Check
                                        ↓
                                 Database Logging
                                        ↓
                                  Usage Tracking
```

### 4.3 Database Schema Extensions

```sql
-- Copilot-specific tables
copilot_interactions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  project_id UUID REFERENCES projects,
  interaction_type VARCHAR,
  prompt TEXT,
  response JSONB,
  model VARCHAR,
  tokens_used INTEGER,
  created_at TIMESTAMP
)

copilot_feedback (
  id UUID PRIMARY KEY,
  interaction_id UUID REFERENCES copilot_interactions,
  feedback BOOLEAN,
  feedback_text TEXT,
  created_at TIMESTAMP
)

copilot_usage (
  team_id UUID REFERENCES teams,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  requests_count INTEGER,
  tokens_used INTEGER,
  PRIMARY KEY (team_id, period_start)
)
```

## 5. Deployment Architecture

### 5.1 Container Configuration

```yaml
# Additional service in docker-compose
plasmic-copilot-backend:
  build: 
    context: ./platform/wab
    dockerfile: Dockerfile
  command: ["node", "copilot-backend.js"]
  ports:
    - "3004:3004"
  environment:
    - NODE_ENV=production
    - DATABASE_URI=${DATABASE_URI}
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  depends_on:
    - postgres
```

### 5.2 ECS Task Definition

```json
{
  "family": "plasmic-copilot",
  "taskRoleArn": "arn:aws:iam::...:role/plasmic-copilot-task",
  "executionRoleArn": "arn:aws:iam::...:role/plasmic-copilot-execution",
  "networkMode": "awsvpc",
  "containerDefinitions": [{
    "name": "plasmic-copilot",
    "image": "plasmic/wab:latest",
    "command": ["node", "copilot-backend.js"],
    "portMappings": [{
      "containerPort": 3004,
      "protocol": "tcp"
    }],
    "environment": [
      {"name": "NODE_ENV", "value": "production"},
      {"name": "PORT", "value": "3004"}
    ],
    "secrets": [
      {"name": "DATABASE_URI", "valueFrom": "arn:aws:secretsmanager:..."},
      {"name": "OPENAI_API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
    ]
  }]
}
```

## 6. UI Generation Details

### 6.1 Prompt Engineering Strategy

The UI generation uses sophisticated prompts to ensure quality output:

```typescript
// System prompt includes:
- Plasmic-specific guidelines
- HTML fragment generation (no document tags)
- Inline styling requirements
- Design token integration
- Accessibility standards

// Context injection:
- Available design tokens → CSS variables
- User's specific request
- Image references (if provided)
- Framework constraints
```

### 6.2 Design Token Integration

When a project has design tokens, they're automatically integrated:

```javascript
// Token provided:
{
  "name": "primary",
  "type": "Color",
  "value": "#0054E4"
}

// Generated HTML uses:
style="background-color: var(--token-primary);"
```

### 6.3 Response Processing

```typescript
// Generated response format
{
  "actions": [{
    "name": "insert-html",
    "data": {
      "html": "<generated-component-markup/>"
    }
  }]
}

// Or for token creation:
{
  "actions": [{
    "name": "add-token",
    "data": {
      "tokenType": "Color",
      "name": "accent",
      "value": "#FF6B6B"
    }
  }]
}
```

## 7. Performance & Scaling

### 7.1 Caching Strategy

- **Cache Key Generation**: SHA-256 hash of request parameters
- **TTL**: 15 minutes (in-memory), indefinite (DynamoDB)
- **Cache Invalidation**: Manual or on model updates

### 7.2 Rate Limiting

```typescript
// Tiered rate limits
- Public API: 10 requests/hour
- Free tier: 100 requests/day
- Pro tier: 1000 requests/day
- Enterprise: Custom limits
```

### 7.3 Worker Pool Configuration

```bash
# Recommended settings for copilot service
GENERIC_WORKER_POOL_SIZE=2  # For async processing
MAX_CONCURRENT_REQUESTS=50  # Per instance
REQUEST_TIMEOUT=30000       # 30 seconds
```

## 8. Monitoring & Observability

### 8.1 Key Metrics

- **Service Metrics**:
  - Request rate and latency
  - LLM API response times
  - Cache hit/miss rates
  - Error rates by type

- **Business Metrics**:
  - Usage by team/tier
  - Token consumption
  - Feature adoption rates
  - User satisfaction (via feedback)

### 8.2 Logging Strategy

```typescript
// Structured logging for all copilot requests
{
  level: "info",
  service: "copilot",
  userId: "...",
  teamId: "...",
  requestType: "ui-generation",
  model: "gpt-4",
  tokensUsed: 1234,
  cacheHit: false,
  latency: 2341
}
```

## 9. Security Considerations

### 9.1 Data Privacy

- User prompts are logged but can be excluded per compliance
- Generated content is cached with user isolation
- API keys stored in secure secrets manager

### 9.2 Input Validation

- Prompt injection protection
- Content filtering for harmful outputs
- Size limits on generated content

## 10. Future Roadmap

### 10.1 Planned Enhancements

1. **Model Improvements**:
   - Support for newer GPT models
   - Custom fine-tuned models
   - Local model deployment option

2. **Feature Expansions**:
   - Component library learning
   - Design system inference
   - Multi-language support

3. **Integration Deepening**:
   - IDE plugins
   - CI/CD integration
   - Design tool bridges

### 10.2 Scaling Considerations

- Implement request queuing for burst handling
- Add geographical distribution for latency
- Consider edge deployment for faster responses

## Conclusion

The AI/Copilot features represent a significant value-add to the Plasmic platform, requiring custom infrastructure and careful integration. While the core Plasmic platform is open source, these AI capabilities are proprietary additions that enhance the development experience through intelligent assistance and automation.

The architecture is designed to be:
- **Scalable**: Horizontal scaling of stateless copilot service
- **Extensible**: Easy addition of new LLM providers and features
- **Maintainable**: Clear separation from core platform
- **Secure**: Proper isolation and rate limiting
- **Cost-effective**: Intelligent caching and model selection

This positions Plasmic as not just a visual builder, but an AI-enhanced development platform that accelerates the design-to-code workflow.
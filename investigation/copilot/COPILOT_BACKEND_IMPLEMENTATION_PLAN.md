# Plasmic Copilot Backend Implementation Plan

## Overview

This plan outlines the implementation of a custom copilot backend service that integrates with Plasmic's visual web builder. The service will handle natural language queries to generate code, UI components, and provide development assistance through LLM integration.

## Existing Plasmic Copilot Architecture

### Current Implementation Overview

The Plasmic copilot feature is a comprehensive AI assistant integrated into the visual web builder that helps users generate code, create UI components, and debug issues. Here's how it currently works:

#### 1. **Client-Side Components**

**Location**: `/platform/wab/src/wab/client/components/copilot/`

The frontend consists of several React components:
- **`useCopilot.tsx`**: Main React hook managing copilot state, including:
  - Loading states and error handling
  - Copilot history management
  - Query tracking for analytics
  - Rate limit enforcement (quota exceeded state)
  - Integration with StudioCtx for project context

- **UI Components**: Dialog boxes, prompt inputs, and message displays for user interaction
  - `CopilotPromptDialog.tsx` - Main dialog interface
  - `CopilotPromptInput.tsx` - Text input with multiline support
  - `CopilotPromptImage.tsx` - Image upload for UI generation
  - `CopilotCodePrompt.tsx` - Code-specific prompt interface
  - `CopilotLikeDislike.tsx` - Feedback collection UI

- **Integration Points**:
  - Data binding editor (`DataPicker.tsx`)
  - Template text editor (`TemplatedTextEditor.tsx`)
  - Component property panels

#### 2. **API Communication Layer**

**Location**: `/platform/wab/src/wab/shared/SharedApi.ts`

The `SharedApi` class provides methods for API communication:
```typescript
async queryCopilot(req: QueryCopilotRequest): Promise<QueryCopilotResponse> {
  return this.req<QueryCopilotRequest, QueryCopilotResponse>({
    method: "POST",
    url: `${this.baseUrl}/copilot`,
    data: req,
  });
}

async queryUiCopilot(req: QueryCopilotUiRequest): Promise<CopilotResponseData> {
  return this.req<QueryCopilotUiRequest, CopilotResponseData>({
    method: "POST", 
    url: `${this.baseUrl}/copilot/ui`,
    data: req,
  });
}
```

#### 3. **Server-Side Implementation**

**LLM Integration** (`/platform/wab/src/wab/server/copilot/llms.ts`):
- **OpenAIWrapper**: Wraps OpenAI API with caching layer
  - Uses DynamoDB for response caching
  - Implements SHA-256 hashing for cache keys
  - Supports all OpenAI chat completion parameters

- **AnthropicWrapper**: Wraps Anthropic Claude API
  - Converts between OpenAI and Anthropic message formats
  - Maps roles: "assistant" → "Assistant", others → "Human"
  - Transforms stop reasons between API formats
  - Currently uses legacy Claude v1 API format

**Database Layer** (`/platform/wab/src/wab/server/entities/Entities.ts`):
- `CopilotInteraction` entity: Stores authenticated user interactions
- `PublicCopilotInteraction` entity: Stores anonymous interactions
- Tracks: prompts, responses, model used, feedback, project context

**Business Logic** (`/platform/wab/src/wab/server/db/DbMgr.ts`):
- Rate limiting logic (100 requests/day per user)
- Interaction storage and retrieval
- Feedback management
- Admin-only feedback querying

#### 4. **Request Flow**

1. **User Input** → React component captures user's natural language request
2. **Context Collection** → Current code, project state, component hierarchy gathered
3. **API Request** → SharedApi sends typed request to backend
4. **Route Handler** → Express route (not visible in OSS code) receives request
5. **Business Logic** → DbMgr processes request, checks rate limits
6. **LLM Call** → OpenAI/Anthropic wrapper makes API call (or returns cached response)
7. **Response Processing** → Format response, store interaction, return to client
8. **UI Update** → React components display response, enable feedback

#### 5. **Feature Flags**

Located in `/platform/wab/src/wab/shared/devflags.ts`:
- `copilotTab`: Enable/disable copilot tab (default: false)
- `copilotClaude`: Enable Claude model (default: false)  
- `disablePublicCopilot`: Disable anonymous access (default: false)

### Integration Points for Custom Backend

Your custom backend will replace the server-side components while maintaining compatibility with the existing client-side code. Here's where you integrate:

#### 1. **API Endpoint Replacement**
You need to implement these exact endpoints with matching request/response formats:
- `POST /api/v1/copilot` - Main copilot endpoint
- `POST /api/v1/copilot/ui` - UI generation endpoint
- `POST /api/v1/copilot/ui/public` - Public UI endpoint
- `POST /api/v1/copilot-feedback` - Feedback submission
- `GET /api/v1/copilot-feedback` - Feedback retrieval

#### 2. **Client Configuration Options**
- **Option A**: Modify `SharedApi.ts` to point to your backend URL
- **Option B**: Use a proxy to redirect copilot requests to your backend
- **Option C**: Configure baseUrl in Plasmic app configuration

#### 3. **Data Format Compatibility**
Your backend must handle these exact TypeScript interfaces from `ApiSchema.ts`:

**Request Types**:
```typescript
// Union type for main copilot endpoint
type QueryCopilotRequest = 
  | QueryCopilotChatRequest      // type: "chat"
  | QueryCopilotCodeRequest      // type: "code" 
  | QueryCopilotSqlCodeRequest   // type: "code-sql"
  | QueryCopilotDebugRequest     // type: "debug"

// Chat request includes conversation history
interface QueryCopilotChatRequest {
  type: "chat";
  projectId: ProjectId;
  messages: CopilotChatEntry[];  // Array of {role, msg, currentComponent, commandData?}
  useClaude?: boolean;
}

// UI generation request  
interface QueryCopilotUiRequest {
  type: "ui";
  projectId: ProjectId;
  images: CopilotImage[];        // Base64 images with type (png, jpeg, etc)
  goal: string;                  // Natural language description
  tokens?: CopilotToken[];       // Existing design tokens
  useClaude?: boolean;
}
```

**Response Types**:
```typescript
// General copilot response
interface QueryCopilotResponse {
  response: string;              // Main text response
  dataSourcesDebug?: string;     // Debug info
  rawDebug?: string;
  typeDebug?: string;
}

// UI generation response with structured actions
interface QueryCopilotUiResponse {
  data: CopilotUiActions;
  copilotInteractionId: CopilotInteractionId;
}

// Structured UI actions (from prompt-utils.ts)
type CopilotUiActions = {
  actions: Array<
    | { name: "insert-html"; data: { html: string } }
    | { name: "add-token"; data: { 
        tokenType: StyleTokenType;
        name: string;
        value: string;  // Including unit: "10px", "#fff123", etc
      }}
  >
}

#### 4. **Expected Behaviors**
- Cache LLM responses to reduce costs (Plasmic uses DynamoDB)
- Track all interactions with unique IDs
- Enforce rate limits (configurable, default 100/day)
- Support both OpenAI and Anthropic models
- Return errors in expected format for client handling

#### 5. **Missing Components in OSS**
The following are not visible in the open-source code:
- Express route handlers that connect HTTP endpoints to DbMgr methods
- Actual prompt templates used for different query types
- Specific model configurations and parameters
- Production caching infrastructure details

### Utility Functions and Helpers

The codebase includes several utilities in `/platform/wab/src/wab/shared/copilot/prompt-utils.ts`:

**Token Counting**:
- Uses `gpt3-tokenizer` to count tokens in prompts
- Important for staying within model context limits

**Formatting Helpers**:
```typescript
mdCode(content, lang)     // Wraps code in markdown code blocks
humanJson(x)              // Pretty-printed JSON for readability  
typescript(x)             // TypeScript code blocks
showCompletionRequest()   // Formats chat history for debugging
```

**Chain Props Interfaces**:
- `CopilotCodeChainProps`: For code generation (includes currentCode, data context, goal)
- `CopilotSqlCodeChainProps`: For SQL generation (includes schema information)
- `CopilotUiChainProps`: For UI generation (includes images, tokens, public mode flag)

**Caching Implementation**:
- Cache keys generated using SHA-256 hash of request parameters
- DynamoDB table used for persistent caching
- Cache includes model responses to reduce API costs

### Where Copilot AI Calls Are Made

The copilot functionality is triggered from multiple places throughout the Plasmic Studio:

#### 1. **Top Navigation Bar**
- **Location**: `/platform/wab/src/wab/client/components/top-bar/TopBar.tsx`
- **Trigger**: AI button in top bar
- **Action**: Opens UI copilot for generating components/designs

#### 2. **Keyboard Shortcut**
- **Shortcut**: Cmd/Ctrl + K
- **Handler**: `/platform/wab/src/wab/client/shortcuts/studio/studio-shortcut-handlers.ts`
- **Action**: Toggles UI copilot dialog

#### 3. **Code Editors Throughout Studio**
- **Data Binding Editor**: 
  - Location: `DataPicker.tsx`, `DataPickerCodeEditorLayout.tsx`
  - Use: Generate JavaScript expressions for data transformations
  - Enabled when `DEVFLAGS.showCopilot` is true
  
- **Templated Text Editor**:
  - Location: `TemplatedTextEditor.tsx`
  - Use: Create dynamic text expressions
  
- **SQL Editor**:
  - Use: Generate SQL queries with schema awareness
  - Passes `DataSourceSchema` for context

#### 4. **Component Property Panels**
- Various property editors integrate copilot for expression generation
- Context includes current component state and available data

#### 5. **Copilot Dialog Types**

**UI Copilot Dialog** (`CopilotUiPrompt.tsx`):
- Accepts image uploads as design reference
- Generates HTML snippets
- Creates design tokens
- Returns structured actions (insert-html, add-token)

**Code Copilot Dialog** (`CopilotCodePrompt.tsx`):
- JavaScript code generation
- SQL query generation
- Context-aware suggestions based on current code

#### 6. **API Call Flow**
1. User triggers copilot from any integration point
2. `useCopilot` hook manages state and history
3. Calls `SharedApi.queryCopilot()` or `SharedApi.queryUiCopilot()`
4. Tracks interaction for analytics
5. Stores response in copilot history
6. Enables feedback collection

### Key Implementation Considerations

1. **Maintain Interface Compatibility**: Any deviation from expected request/response formats will break the Plasmic Studio integration

2. **Preserve Context Handling**: The client sends project context, current code, and component hierarchy - your backend should utilize this effectively

3. **Support Streaming**: While not visible in current implementation, consider supporting streaming responses for better UX

4. **Handle Edge Cases**: 
   - Empty responses
   - Rate limit exceeded
   - Model unavailable
   - Invalid project context

5. **Security Considerations**:
   - Validate project access permissions
   - Sanitize user inputs before sending to LLM
   - Don't expose raw LLM responses without filtering
   - Implement proper authentication (except for public endpoint)

6. **Context-Aware Responses**:
   - Code copilot receives current code, data context, and goal
   - SQL copilot receives database schema for accurate queries
   - UI copilot receives images and existing design tokens
   - Use provided context to generate relevant responses

## Use Case-Focused Implementation Guide

When implementing the LLM integration, optimize for these specific use cases that Plasmic users encounter:

### 1. **UI Generation from Natural Language** (Top Bar AI Button)
**User Intent**: "Create a hero section with a headline, subtitle, and call-to-action button"

**Implementation Focus**:
- Generate semantic HTML with proper structure
- Use modern CSS patterns (flexbox, grid)
- Include responsive design considerations
- Return clean, production-ready code
- Support image uploads as design reference

**LLM Prompt Strategy**:
```typescript
const uiPrompt = `
You are an expert UI developer. Generate clean, semantic HTML based on the user's description.
Requirements:
- Use semantic HTML5 elements
- Include inline styles using modern CSS
- Make it responsive by default
- Follow accessibility best practices
User request: ${goal}
${images ? 'Reference images provided - match the design closely' : ''}
`;
```

### 2. **Data Binding Expressions** (Data Picker)
**User Intent**: "Filter items where price is less than 100 and category is 'electronics'"

**Implementation Focus**:
- Generate valid JavaScript expressions
- Handle common data transformations
- Use appropriate array methods (filter, map, reduce)
- Consider null/undefined safety
- Work with the existing data context

**LLM Prompt Strategy**:
```typescript
const dataBindingPrompt = `
Generate a JavaScript expression for data transformation.
Available data: ${JSON.stringify(data)}
Current expression: ${currentCode || 'none'}
Goal: ${goal}
Return only the JavaScript expression, no explanation.
`;
```

### 3. **SQL Query Generation** (Database Integration)
**User Intent**: "Get top 10 customers by total order value this month"

**Implementation Focus**:
- Generate correct SQL for the target database
- Use provided schema information
- Include proper JOINs and aggregations
- Add appropriate WHERE clauses
- Consider query performance

**LLM Prompt Strategy**:
```typescript
const sqlPrompt = `
Generate a SQL query based on the schema and requirements.
Database schema:
${formatSchema(dataSourceSchema)}
Current query: ${currentCode || 'none'}
Requirement: ${goal}
Generate only the SQL query, optimized for ${dataSourceSchema.type}.
`;
```

### 4. **Dynamic Text Expressions** (Templated Text Editor)
**User Intent**: "Show 'Good morning/afternoon/evening' based on current time"

**Implementation Focus**:
- Create JavaScript template literals
- Handle conditional logic elegantly
- Format dates/numbers appropriately
- Work with component props and state

**LLM Prompt Strategy**:
```typescript
const textExpressionPrompt = `
Create a JavaScript expression for dynamic text.
Available variables: ${JSON.stringify(context)}
Goal: ${goal}
Use template literals and ternary operators as needed.
Return a single expression that evaluates to a string.
`;
```

### 5. **Component Logic and Event Handlers**
**User Intent**: "When button is clicked, validate form and submit if valid"

**Implementation Focus**:
- Generate event handler functions
- Include proper error handling
- Use async/await for API calls
- Integrate with component state
- Follow React best practices

**LLM Prompt Strategy**:
```typescript
const componentLogicPrompt = `
Generate React component logic.
Component context: ${componentInfo}
Current code: ${currentCode}
Task: ${goal}
Use modern JavaScript, handle errors, and follow React conventions.
`;
```

### 6. **Design Token Generation** (UI Copilot)
**User Intent**: "Create a color palette based on this image"

**Implementation Focus**:
- Extract colors from uploaded images
- Generate cohesive color schemes
- Create spacing and typography scales
- Follow design system conventions
- Use standard CSS units

**Token Generation Logic**:
```typescript
const tokenActions = [
  { name: "add-token", data: { 
    tokenType: "color",
    name: "primary-500", 
    value: "#3B82F6" 
  }},
  { name: "add-token", data: { 
    tokenType: "spacing",
    name: "space-4", 
    value: "16px" 
  }}
];
```

### 7. **Debugging Assistance**
**User Intent**: "Why is my component not re-rendering when state changes?"

**Implementation Focus**:
- Analyze provided code/context
- Identify common React pitfalls
- Suggest specific fixes
- Explain the root cause
- Provide educational value

### Key Implementation Principles

1. **Context Awareness**:
   - Always use the provided context (current code, data schema, component state)
   - Generate code that integrates with existing patterns
   - Respect the user's coding style

2. **Output Quality**:
   - Generate production-ready code, not examples
   - Include error handling where appropriate
   - Follow framework best practices (React, SQL, etc.)
   - Make code readable and maintainable

3. **User Experience**:
   - Respond quickly (use caching effectively)
   - Provide helpful error messages
   - Support iterative refinement
   - Track what works for continuous improvement

4. **Prompt Engineering Tips**:
   - Be specific about output format
   - Include examples in system prompts
   - Use few-shot learning for complex patterns
   - Validate generated code before returning

5. **Model Selection**:
   - Use GPT-4 for complex logic and debugging
   - Use GPT-3.5 for simple transformations (cost optimization)
   - Use Claude for longer context windows
   - Consider specialized models for SQL generation

## Phase 1: Core Service Infrastructure (Week 1)

### 1.1 Project Setup
- [ ] Initialize Node.js/TypeScript project with Express
- [ ] Set up project structure matching Plasmic conventions
- [ ] Configure TypeScript with strict typing
- [ ] Set up development environment with hot reload
- [ ] Configure linting and testing framework

### 1.2 LLM Integration Layer
- [ ] Create abstract LLM interface for provider flexibility
- [ ] Implement OpenAI integration wrapper
  - Support for GPT-4/GPT-3.5 models
  - Streaming response support
  - Error handling and retry logic
- [ ] Implement Anthropic/Claude integration wrapper
  - API format conversion (OpenAI <-> Anthropic)
  - Model selection (Claude 2/3)
- [ ] Add configuration for API keys and model selection

### 1.3 Caching Infrastructure
- [ ] Implement caching interface
- [ ] Create DynamoDB cache implementation (matching Plasmic's approach)
- [ ] Add Redis cache as alternative option
- [ ] Implement cache key generation using SHA-256 hashing
- [ ] Add cache TTL and invalidation strategies

## Phase 2: API Implementation (Week 2)

### 2.1 Core Copilot Endpoints

#### POST /api/v1/copilot
Handles general copilot queries (chat, code, SQL, debug)

```typescript
interface Handlers {
  chat: (req: QueryCopilotChatRequest) => QueryCopilotResponse
  code: (req: QueryCopilotCodeRequest) => QueryCopilotResponse
  'code-sql': (req: QueryCopilotSqlCodeRequest) => QueryCopilotResponse
  debug: (req: QueryCopilotDebugRequest) => QueryCopilotResponse
}
```

- [ ] Implement request routing based on `type` field
- [ ] Create handler for chat interactions
- [ ] Create handler for code generation
- [ ] Create handler for SQL code generation
- [ ] Create handler for debug requests
- [ ] Add request validation middleware

#### POST /api/v1/copilot/ui
Handles UI-specific copilot requests

- [ ] Implement image processing for design-to-code
- [ ] Create HTML generation from natural language
- [ ] Implement design token extraction
- [ ] Return structured `CopilotUiActions` response

#### POST /api/v1/copilot/ui/public
Public endpoint without authentication

- [ ] Implement simplified UI generation
- [ ] Add rate limiting for anonymous users
- [ ] Track public interactions separately

### 2.2 Feedback Endpoints

#### POST /api/v1/copilot-feedback
- [ ] Implement feedback submission
- [ ] Validate interaction ID exists
- [ ] Store feedback with description

#### GET /api/v1/copilot-feedback
- [ ] Implement paginated feedback query
- [ ] Add filtering by query string
- [ ] Calculate aggregate statistics

## Phase 3: Data Storage & Tracking (Week 3)

### 3.1 Database Schema
- [ ] Set up PostgreSQL/MySQL database
- [ ] Create migrations for:
  ```sql
  -- Authenticated user interactions
  CREATE TABLE copilot_interaction (
    id UUID PRIMARY KEY,
    user_prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    full_prompt_snapshot TEXT,
    model VARCHAR(50),
    feedback BOOLEAN,
    feedback_description TEXT,
    project_id UUID,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_by_id UUID
  );

  -- Anonymous interactions
  CREATE TABLE public_copilot_interaction (
    id UUID PRIMARY KEY,
    user_prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    full_prompt_snapshot TEXT,
    model VARCHAR(50),
    created_at TIMESTAMP
  );
  ```

### 3.2 Interaction Tracking
- [ ] Generate unique interaction IDs
- [ ] Store complete prompt/response pairs
- [ ] Track model used for each request
- [ ] Implement soft delete functionality

## Phase 4: Advanced Features (Week 4)

### 4.1 Rate Limiting
- [ ] Implement per-user rate limiting (100 requests/day default)
- [ ] Add configurable limits per tier/user
- [ ] Create rate limit headers in responses
- [ ] Add bypass for admin users

### 4.2 Context Management
- [ ] Implement project context loading
- [ ] Add component hierarchy understanding
- [ ] Create token counting utilities
- [ ] Implement context window management

### 4.3 Prompt Engineering
- [ ] Create specialized prompts for each query type
- [ ] Implement Plasmic-specific code generation rules
- [ ] Add React/TypeScript best practices
- [ ] Create UI component generation templates

## Phase 5: Integration & Testing (Week 5)

### 5.1 Plasmic Integration
- [ ] Update SharedApi.ts endpoint URLs (or use proxy)
- [ ] Test with Plasmic Studio locally
- [ ] Verify all request/response formats match
- [ ] Test authentication flow

### 5.2 Testing Suite
- [ ] Unit tests for LLM wrappers
- [ ] Integration tests for all endpoints
- [ ] Mock LLM responses for consistent testing
- [ ] Load testing for performance validation

### 5.3 Documentation
- [ ] API documentation with examples
- [ ] Deployment guide
- [ ] Configuration reference
- [ ] Troubleshooting guide

## Technical Requirements

### Environment Variables
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
DYNAMODB_ACCESS_KEY=...
DYNAMODB_SECRET_KEY=...
DYNAMODB_REGION=us-west-2
PORT=3000
```

### Dependencies
```json
{
  "dependencies": {
    "@types/express": "^4.17.17",
    "express": "^4.18.2",
    "openai": "^4.0.0",
    "@anthropic-ai/sdk": "^0.6.0",
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "redis": "^4.6.0",
    "pg": "^8.11.0",
    "joi": "^17.9.0",
    "winston": "^3.10.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "express-rate-limit": "^6.10.0"
  }
}
```

### Deployment Considerations
- Dockerize application for consistent deployment
- Support horizontal scaling with stateless design
- Use environment-based configuration
- Implement health check endpoints
- Add monitoring and logging (OpenTelemetry compatible)

## Success Criteria
1. All Plasmic copilot features work with the new backend
2. Response times < 2s for cached requests
3. 99.9% uptime for service availability
4. Support for 1000+ concurrent users
5. Comprehensive test coverage (>80%)

## Next Steps
1. Review and approve implementation plan
2. Set up development environment
3. Begin Phase 1 implementation
4. Schedule weekly progress reviews
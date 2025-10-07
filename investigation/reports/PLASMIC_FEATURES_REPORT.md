# Plasmic Features Investigation Report

## Table of Contents
1. [Tutorial Templates System](#tutorial-templates-system)
2. [Copilot Architecture](#copilot-architecture)
3. [Key Findings](#key-findings)
4. [Implementation Details](#implementation-details)

---

## Tutorial Templates System

### Overview
Plasmic's tutorial system provides interactive, guided experiences that teach users how to build specific types of applications. The system combines starter templates with interactive onboarding tours.

### Architecture Components

#### 1. Tutorial Template Configuration
Tutorial templates are configured through the `StarterProjectConfig` interface:

```typescript
interface StarterProjectConfig {
  name: string;              // Tutorial name
  projectId?: string;        // Direct project to clone
  baseProjectId?: string;    // Published version to clone
  tag: string;              // Unique identifier
  description: string;      // Tutorial description
  highlightType?: "first" | "second" | "third"; // Visual priority
  href?: string;           // External documentation link
  publishWizard?: boolean; // Show publish wizard on first open
  showPreview?: boolean;   // Enable template preview
}
```

#### 2. Interactive Tutorial System

**Template-to-Tutorial Mapping**
- Configured via `appConfig.templateTours`
- Maps `clonedFromProjectId` to specific tutorial flows
- Examples: `"portfolio"`, `"admin-panel"`, `"app"`

**Tutorial Step Structure**
```typescript
interface TutorialStep {
  name: string;                    // Step identifier
  target: string;                  // CSS selector for UI element
  content: string;                 // Markdown instructions
  nextButtonText?: string;         // Custom button text
  shouldAdvance?: (event) => boolean; // Auto-advance condition
  onNext?: () => Promise<void>;    // Pre-advance action
  postStepFlags?: Partial<TutorialStateFlags>; // UI state
}
```

#### 3. Tutorial Features

- **Automatic Launch**: Tutorials start automatically when creating from specific templates
- **Progress Tracking**: Uses browser storage to track completion
- **Smart Visibility**: Pauses when target elements aren't visible
- **Event-Based Advancement**: Listens for user actions to auto-progress
- **Analytics Integration**: Tracks tutorial events (started, completed, quit)
- **Tutorial Databases**: Pre-populated demo data for data-driven tutorials

### Implementation Flow

1. User selects a tutorial template from starter sections
2. System clones the project (from `projectId` or `baseProjectId`)
3. If template has associated tour, it auto-starts
4. Tutorial guides user through building features
5. Progress is saved to browser storage
6. Tutorial completion is tracked in user's profile

---

## Copilot Architecture

### Overview
The Copilot feature is an AI-powered assistant integrated into Plasmic Studio with three distinct modes: UI generation, code generation, and SQL query generation.

### Core Components

#### 1. Copilot Types
```typescript
type CopilotType = "ui" | "code" | "sql";
```

- **UI Copilot**: Generates HTML/components from prompts and images
- **Code Copilot**: Generates JavaScript expressions and data transformations
- **SQL Copilot**: Generates SQL queries based on schema

#### 2. Client-Side Architecture

**Main Components**
- `useCopilot.tsx` - Central hook managing copilot interactions
- `CopilotUiPrompt.tsx` - UI generation interface
- `CopilotCodePrompt.tsx` - Code/SQL generation interface
- `CopilotPromptDialog.tsx` - Reusable dialog wrapper
- `CopilotLikeDislike.tsx` - Feedback collection

**State Management**
```typescript
// In StudioCtx
copilotHistory: Map<CopilotType, CopilotInteractionData[]>;
copilotFeedback: Map<string, FeedbackData>;
```

#### 3. API Layer

**Endpoints** (defined in `SharedApi.ts`)
```typescript
POST /api/v1/copilot          // Code/SQL generation
POST /api/v1/copilot/ui       // UI generation
POST /api/v1/copilot-feedback // Feedback submission
GET /api/v1/copilot-feedback  // Query feedback (admin)
POST /api/v1/copilot/ui/public // Public access
```

#### 4. Backend Architecture

**LLM Integration** (`llms.ts`)
- Primary: OpenAI GPT-4 models
- Alternative: Anthropic Claude (via `copilotClaude` devflag)
- Caching: DynamoDB for response caching
- Rate limiting: Per-user daily quotas

**Database Schema**
```typescript
CopilotInteraction {
  id: string;
  userId: string;
  projectId: string;
  createdAt: Date;
  model: string;
  userPrompt: string;
  fullPromptSnapshot: string;
  response: string;
  feedback?: "positive" | "negative";
  feedbackDescription?: string;
}
```

#### 5. UI Copilot Features

**Action Types** (`prompt-utils.ts`)
```typescript
interface UiCopilotActions {
  "insert-html": {
    content: string;  // Generated HTML
    css?: string;     // Optional styles
  };
  "add-token": {
    name: string;
    value: string;
    type: TokenType;
  };
}
```

**Capabilities**
- Image-to-UI conversion
- HTML generation from text descriptions
- Design token creation
- Style preservation

#### 6. Integration Points

- **ViewOps**: Inserts generated UI components
- **DataPicker**: Integrates code expressions
- **WebImporter**: Processes HTML into Plasmic components
- **Token System**: Creates and manages design tokens

### Data Flow

1. **User Input**: Prompt text + optional images/context
2. **Context Enrichment**: 
   - UI: Design tokens, current selection
   - Code: Variable context, data schemas
   - SQL: Database schema, table structures
3. **LLM Processing**: Structured prompts sent to AI
4. **Response Parsing**: Zod validation of structured responses
5. **UI Integration**: Apply changes to project

---

## Key Findings

### Tutorial System
1. **Sophisticated Onboarding**: Combines starter templates with interactive tours
2. **Context-Aware**: Tutorials adapt to user progress and actions
3. **Production-Ready**: Includes analytics, progress tracking, and error handling
4. **Extensible**: Easy to add new tutorials via configuration

### Copilot System
1. **Multi-Modal AI**: Supports UI, code, and SQL generation
2. **Deep Integration**: Seamlessly integrated with Studio workflows
3. **Enterprise Features**: Rate limiting, caching, feedback collection
4. **Flexible Architecture**: Supports multiple LLM providers

### Missing Pieces
1. **Copilot Endpoint Implementation**: Server-side endpoint handlers not found in expected locations
2. **Route Generation**: Likely uses auto-generated routes from SharedApi interface
3. **External Services**: Some functionality might be in separate services

---

## Implementation Details

### To Add Tutorial Templates

1. Configure in `starterSections`:
```json
{
  "title": "Tutorials",
  "tag": "general",
  "projects": [{
    "baseProjectId": "abc123",
    "name": "Learn Feature X",
    "tag": "tutorial-feature-x",
    "description": "Interactive tutorial",
    "highlightType": "first"
  }]
}
```

2. Add to `templateTours` mapping:
```json
"templateTours": {
  "abc123": "feature-x-tour"
}
```

3. Define tour steps in `TutorialTours.tsx`

### To Enable Copilot Features

1. Enable via devflags:
```json
{
  "copilotTab": true,
  "copilotClaude": false,  // Use GPT-4
  "disablePublicCopilot": false
}
```

2. Configure rate limits in database
3. Ensure LLM API keys are configured
4. Monitor usage via CopilotUsage table

### Security Considerations

1. **Rate Limiting**: Prevents abuse via daily quotas
2. **Project Scoping**: Interactions tied to specific projects
3. **Feedback System**: Allows quality monitoring
4. **Public Access**: Separate tracking for anonymous usage

---

## Recommendations

1. **Tutorial Enhancement**: Consider adding more interactive tutorials for complex features
2. **Copilot Expansion**: Could add more specialized copilot types (e.g., animation, responsive design)
3. **Analytics**: Implement deeper analytics on tutorial completion and copilot usage
4. **Documentation**: Create user-facing documentation for copilot best practices

---

*Report compiled on: January 17, 2025*
*Based on codebase analysis of Plasmic platform*
# Plan: Copilot "Improve Component" Feature

## Overview
Create a new copilot action that allows users to select a component in Plasmic Studio and request AI-powered design improvements.

## User Flow
1. User selects a component in the canvas
2. User clicks "Improve Component" button (next to current "Generate UI" button)
3. Dialog appears with prompt input (similar to current copilot)
4. User provides guidance (e.g., "make more accessible", "improve mobile layout")
5. AI analyzes component model and returns suggestions
6. User can preview and apply changes

## Technical Implementation Plan

### Phase 1: Add UI Button and Dialog

#### 1.1 Add "Improve Component" Button
- **Location**: Next to existing "Generate UI" button in the toolbar
- **Icon**: Use a magic wand or sparkle icon (e.g., `SparklesIcon` or `WandIcon`)
- **Visibility**: Only show when a component is selected
- **Tooltip**: "Improve selected component with AI"
- **File**: `/platform/wab/src/wab/client/components/TopBar/TopBar.tsx`

```typescript
// Add button next to Generate UI button
{viewCtx.focusedTpl() && (
  <TopBarButton
    icon={<SparklesIcon />}
    tooltip="Improve component"
    onClick={() => setShowImproveDialog(true)}
  />
)}
```

#### 1.2 Create New Improve Component Dialog
- **Copy From**: `CopilotUiPrompt.tsx` → `ImproveComponentPrompt.tsx`
- **Location**: `/platform/wab/src/wab/client/components/copilot/ImproveComponentPrompt.tsx`
- **Differences from Generate UI**:
  - Pre-populated with selected component context
  - Different prompt suggestions
  - Preview pane shows current component
  - Suggestions panel for improvements

```typescript
// New dialog structure
export function ImproveComponentPrompt({ 
  studioCtx,
  onClose,
  selectedTpl 
}: ImproveComponentPromptProps) {
  // Dialog specifically for improving existing components
  return (
    <Modal
      title="Improve Component with AI"
      visible={true}
      onCancel={onClose}
      width={800}
    >
      <div className="improve-component-dialog">
        <div className="current-component-preview">
          {/* Show current component */}
        </div>
        <div className="improvement-prompt">
          <TextArea 
            placeholder="What would you like to improve? (e.g., 'make more accessible', 'improve mobile layout', 'enhance visual hierarchy')"
            rows={4}
          />
          <div className="suggestion-chips">
            <Chip onClick={() => setPrompt("Improve accessibility")}>
              Accessibility
            </Chip>
            <Chip onClick={() => setPrompt("Optimize for mobile")}>
              Mobile Layout
            </Chip>
            <Chip onClick={() => setPrompt("Enhance visual design")}>
              Visual Design
            </Chip>
            <Chip onClick={() => setPrompt("Improve performance")}>
              Performance
            </Chip>
          </div>
        </div>
        <div className="ai-suggestions">
          {/* AI response will show here */}
        </div>
      </div>
    </Modal>
  );
}
```

### Phase 2: Extract Component Context

#### 2.1 Data to Extract from Selected Component
```typescript
interface ComponentContext {
  // Core model data
  model: {
    tplTree: SerializedTplNode;    // The component structure
    vsettings: VariantSetting[];   // All variant settings
    variants: Variant[];           // Available variants
  };
  
  // Computed information
  computed: {
    componentType: string;         // "hero", "card", "nav", etc.
    usedTokens: string[];         // Design tokens in use
    responsiveBehavior: string;    // How it adapts to breakpoints
    currentStyles: StyleMap;       // Flattened styles for current variant
  };
  
  // Content
  content: {
    texts: string[];              // All text content
    images: ImageInfo[];          // Image sources and alts
    links: LinkInfo[];            // Href and aria labels
  };
  
  // Metadata
  meta: {
    componentName: string;
    isReusable: boolean;
    instanceCount: number;        // How many times used
    lastModified: Date;
  };
}
```

#### 2.2 Context Extraction Function
```typescript
// Location: /platform/wab/src/wab/client/components/copilot/extractComponentContext.ts

function extractComponentContext(
  tpl: TplNode,
  viewCtx: ViewCtx
): ComponentContext {
  const vtm = viewCtx.variantTplMgr();
  const studioCtx = viewCtx.studioCtx;
  
  return {
    model: {
      // Serialize the TplNode tree
      tplTree: serializeTplNode(tpl, vtm),
      // Get all variant settings
      vsettings: extractVariantSettings(tpl),
      // Get available variants
      variants: getComponentVariants(tpl)
    },
    computed: {
      // ... compute derived information
    },
    content: {
      // ... extract all content
    },
    meta: {
      // ... gather metadata
    }
  };
}
```

#### 1.3 Dialog User Experience Design

**Layout Structure**:
```
┌─────────────────────────────────────────────────┐
│  Improve Component with AI                    X │
├─────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────────────┐ │
│ │                 │ │ What would you like to  │ │
│ │  Current        │ │ improve?                │ │
│ │  Component      │ │ ┌─────────────────────┐ │ │
│ │  Preview        │ │ │ [Text area]         │ │ │
│ │                 │ │ └─────────────────────┘ │ │
│ │                 │ │ Quick suggestions:      │ │
│ │                 │ │ [Chip] [Chip] [Chip]   │ │
│ └─────────────────┘ └─────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ AI Suggestions:                             │ │
│ │ □ Add aria-label to button                  │ │
│ │ □ Increase contrast ratio to 4.5:1          │ │
│ │ □ Add responsive font sizing                │ │
│ └─────────────────────────────────────────────┘ │
│                          [Cancel] [Apply Selected]│
└─────────────────────────────────────────────────┘
```

**Key Features**:
- Split view: current component + improvement interface
- Checkbox list for selective application of suggestions
- Real-time preview of changes (optional)
- Categorized suggestions (a11y, performance, etc.)

### Phase 3: Define AI Interface

#### 3.1 New Action Schema
```typescript
// Location: /platform/wab/src/wab/shared/copilot/prompt-utils.ts

const CopilotImproveComponentActionSchema = z.object({
  name: z.literal("improve-component"),
  data: z.object({
    analysis: z.object({
      currentIssues: z.array(z.string()),
      opportunities: z.array(z.string()),
      bestPractices: z.array(z.string())
    }),
    suggestions: z.array(z.object({
      title: z.string(),
      description: z.string(),
      impact: z.enum(["high", "medium", "low"]),
      category: z.enum(["accessibility", "responsive", "performance", "visual", "content"])
    })),
    changes: z.array(z.object({
      type: z.enum(["style", "structure", "content", "attribute"]),
      target: z.object({
        path: z.string(),          // Path to element in tree
        selector: z.string()       // Alternative selector
      }),
      operation: z.object({
        // Specific to change type
      })
    }))
  })
});
```

#### 3.2 LLM Prompt Template
```typescript
const IMPROVE_COMPONENT_PROMPT = `
You are a UI/UX expert analyzing a Plasmic component for improvements.

COMPONENT CONTEXT:
${JSON.stringify(context, null, 2)}

USER REQUEST:
"${userPrompt}"

Analyze the component and provide:
1. Current issues (accessibility, usability, performance)
2. Improvement opportunities
3. Specific changes to implement

Focus on:
- Accessibility (WCAG compliance)
- Responsive design
- Performance optimization
- Visual hierarchy
- Content clarity
- Design consistency

Return a structured response following the improvement schema.
`;
```

### Phase 4: Process AI Response

#### 4.1 Response Handler
```typescript
// Location: /platform/wab/src/wab/client/components/copilot/handleImproveResponse.ts

async function handleImproveComponentResponse(
  response: ImproveComponentResponse,
  viewCtx: ViewCtx
) {
  // 1. Show preview dialog with suggestions
  const accepted = await showImprovementPreview(response);
  
  if (accepted) {
    // 2. Apply changes in a transaction
    viewCtx.change(() => {
      for (const change of response.changes) {
        applyComponentChange(change, viewCtx);
      }
    });
    
    // 3. Show success notification
    notification.success({
      message: "Component improved!",
      description: `Applied ${response.changes.length} improvements`
    });
  }
}
```

#### 4.2 Change Application
```typescript
function applyComponentChange(
  change: ComponentChange,
  viewCtx: ViewCtx
) {
  const tpl = findTplByPath(change.target.path);
  const vtm = viewCtx.variantTplMgr();
  
  switch (change.type) {
    case "style":
      applyStyleChange(tpl, change.operation, vtm);
      break;
    case "structure":
      applyStructureChange(tpl, change.operation, viewCtx);
      break;
    case "content":
      applyContentChange(tpl, change.operation, vtm);
      break;
    case "attribute":
      applyAttributeChange(tpl, change.operation, vtm);
      break;
  }
}
```

### Phase 5: Server Integration

#### 5.1 Update Copilot Chain
```typescript
// Location: /platform/wab/src/wab/server/copilot/ui-copilot-chain.ts

// Add to the chain configuration
const improveComponentChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromMessages([
    ["system", IMPROVE_COMPONENT_SYSTEM_PROMPT],
    ["human", "{context}\n\nUser request: {prompt}"]
  ]),
  outputParser: new OutputFixingParser({
    parser: StructuredOutputParser.fromZodSchema(
      CopilotImproveComponentActionSchema
    )
  })
});
```

#### 5.2 API Endpoint Update
```typescript
// Location: /platform/wab/src/wab/server/routes/copilot.ts

// Extend existing endpoint to handle improve mode
app.post("/api/v1/copilot", async (req, res) => {
  const { mode, prompt, context } = req.body;
  
  if (mode === "improve") {
    const result = await improveComponentChain.call({
      context: JSON.stringify(context),
      prompt
    });
    res.json(result);
  }
  // ... existing generate mode
});
```

## Data Model Serialization Details

### What to Include in Context
1. **Full TplNode tree** - Structure and hierarchy
2. **All VariantSettings** - Styles for each variant  
3. **Design tokens** - Used tokens and available tokens
4. **Component parameters** - Props and their types
5. **Current variant combo** - Active responsive/state variants
6. **Computed styles** - Resolved CSS properties
7. **Content** - Text, images, links
8. **Accessibility attributes** - ARIA labels, roles, etc.

### Specific Data Format for AI Request
```typescript
// What actually gets sent to the AI
interface AIRequestPayload {
  // User's improvement request
  userPrompt: string; // "Make this more accessible"
  
  // Component model data
  component: {
    // Hierarchical structure
    structure: {
      type: "div" | "button" | "text" | etc;
      tag?: string;
      className?: string;
      children?: ComponentStructure[];
      
      // Current styles (computed)
      styles: {
        display?: string;
        flexDirection?: string;
        padding?: string;
        margin?: string;
        backgroundColor?: string;
        color?: string;
        fontSize?: string;
        // ... all relevant CSS properties
      };
      
      // HTML attributes
      attributes: {
        role?: string;
        "aria-label"?: string;
        href?: string;
        alt?: string;
        // ... other HTML attributes
      };
      
      // Text content if applicable
      content?: {
        text?: string;
        html?: string;
      };
    };
    
    // Responsive behavior
    variants: {
      base: StyleSet;
      mobile?: StyleSet;
      tablet?: StyleSet;
      hover?: StyleSet;
      focus?: StyleSet;
    };
    
    // Component metadata
    meta: {
      componentType: "hero" | "card" | "nav" | "footer" | "generic";
      semanticRole?: string;
      usesTokens: string[]; // ["--color-primary", "--spacing-lg"]
    };
  };
  
  // Design system context
  designSystem: {
    tokens: {
      colors: Record<string, string>;
      spacing: Record<string, string>;
      typography: Record<string, FontProperties>;
    };
    breakpoints: {
      mobile: number;
      tablet: number;
      desktop: number;
    };
  };
  
  // Constraints
  constraints: {
    preserveLayout: boolean;
    allowStructuralChanges: boolean;
    targetVariants: string[]; // Which variants to improve
  };
}
```

### Example Serialized Component
```json
{
  "userPrompt": "Improve accessibility and mobile responsiveness",
  "component": {
    "structure": {
      "type": "div",
      "tag": "div",
      "className": "hero-section",
      "styles": {
        "display": "flex",
        "flexDirection": "column",
        "padding": "80px 20px",
        "backgroundColor": "#f5f5f5",
        "minHeight": "500px"
      },
      "children": [
        {
          "type": "text",
          "tag": "h1",
          "styles": {
            "fontSize": "48px",
            "fontWeight": "bold",
            "marginBottom": "16px"
          },
          "content": {
            "text": "Welcome to our platform"
          }
        },
        {
          "type": "text",
          "tag": "p",
          "styles": {
            "fontSize": "18px",
            "lineHeight": "1.6",
            "marginBottom": "32px"
          },
          "content": {
            "text": "Build amazing experiences with our tools"
          }
        },
        {
          "type": "button",
          "tag": "button",
          "styles": {
            "padding": "12px 24px",
            "backgroundColor": "#007bff",
            "color": "white",
            "border": "none",
            "borderRadius": "4px"
          },
          "content": {
            "text": "Get Started"
          }
        }
      ]
    },
    "variants": {
      "base": { /* ... */ },
      "mobile": {
        "padding": "40px 16px",
        "h1": { "fontSize": "32px" }
      }
    },
    "meta": {
      "componentType": "hero",
      "usesTokens": []
    }
  },
  "designSystem": {
    "tokens": {
      "colors": {
        "--primary": "#007bff",
        "--text-primary": "#333333"
      },
      "spacing": {
        "--spacing-sm": "8px",
        "--spacing-md": "16px",
        "--spacing-lg": "32px"
      }
    },
    "breakpoints": {
      "mobile": 768,
      "tablet": 1024
    }
  }
}

### Serialization Format
```typescript
interface SerializedComponent {
  // Simplified but complete representation
  root: {
    type: string;
    tag?: string;
    name?: string;
    children: SerializedComponent[];
    styles: {
      base: Record<string, any>;
      variants: Record<string, Record<string, any>>;
    };
    attrs: Record<string, any>;
    content?: {
      text?: string;
      image?: { src: string; alt?: string };
    };
    metadata: {
      id: string;
      className?: string;
      dataAttrs?: Record<string, string>;
    };
  };
  
  // Context
  context: {
    availableTokens: Record<string, any>;
    activeVariants: string[];
    parentComponent?: string;
  };
}
```

## Security & Safety

### Validation Rules
1. **No ID changes** - Preserve all __iid values
2. **Valid CSS only** - Validate all style values
3. **Safe content** - Sanitize any HTML content
4. **Token validation** - Only use existing tokens
5. **Structure limits** - Don't allow infinite nesting

### Permissions
- Only works on components user can edit
- Respects project permissions
- Changes are tracked in history

## Testing Plan

### Phase 1: Unit Tests
- Context extraction accuracy
- Serialization/deserialization
- Change application functions

### Phase 2: Integration Tests
- Full flow from selection to application
- Undo/redo functionality
- Error handling

### Phase 3: AI Response Tests
- Mock AI responses
- Edge case handling
- Performance with large components

## Rollout Strategy

1. **Alpha**: Internal team testing
2. **Beta**: Limited users with feature flag
3. **GA**: Full release with documentation

## Success Metrics

- User engagement (uses per week)
- Acceptance rate (applied vs suggested)
- Time saved (before/after comparison)
- Error rate (failed applications)
- User satisfaction (survey)
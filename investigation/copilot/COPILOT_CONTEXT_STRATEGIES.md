# Copilot Context Strategies for AI-Powered Improvements

## Overview
This document outlines different strategies for passing current project context to the LLM to enable intelligent design suggestions and improvements.

## Strategy 1: Full Model Serialization

### Approach
Provide the complete Plasmic data model to the LLM.

### Implementation
```typescript
const context = {
  schema: getModelSchema(),
  currentComponent: {
    tplTree: serialize(component.tplTree),
    variants: component.variants,
    vsettings: component.vsettings
  },
  globalContext: {
    tokens: site.styleTokens,
    breakpoints: site.breakpoints
  }
}
```

### Pros
- Complete information available
- AI can understand relationships and dependencies
- Enables complex refactoring

### Cons
- Large token usage
- Complex for AI to parse
- May include irrelevant data

## Strategy 2: HTML/CSS Conversion

### Approach
Convert the current selection to semantic HTML/CSS and let the AI work with familiar web standards.

### Implementation
```typescript
function tplToHtml(tpl: TplNode, variants: VariantCombo[]): string {
  const html = renderTplToHtml(tpl);
  const css = extractStyles(tpl, variants);
  return `<style>${css}</style>\n${html}`;
}
```

### Pros
- Familiar format for AI
- Smaller payload
- Can reuse existing insert-html action

### Cons
- Loses Plasmic-specific features (variants, tokens, components)
- Round-trip conversion may lose fidelity
- Limited to style/structure changes

## Strategy 3: Semantic UI Description (Recommended)

### Approach
Generate a high-level semantic description of the UI that includes both structure and intent.

### Implementation
```typescript
interface UIDescription {
  type: "container" | "text" | "image" | "component";
  role: "header" | "navigation" | "content" | "footer";
  children?: UIDescription[];
  styles: {
    layout: "flex" | "grid" | "absolute";
    theme: "primary" | "secondary";
    responsive: Record<string, any>;
  };
  content?: string;
  semantics: {
    purpose: string;
    accessibility: string;
    dataBinding?: string;
  };
}

function describeTpl(tpl: TplNode): UIDescription {
  return {
    type: detectType(tpl),
    role: inferRole(tpl),
    styles: summarizeStyles(tpl),
    children: tpl.children?.map(describeTpl),
    semantics: extractSemantics(tpl)
  };
}
```

### Pros
- Compact and meaningful
- Preserves intent and structure
- AI can reason about purpose
- Supports high-level modifications

### Cons
- Requires custom serialization
- May lose some detail

## Strategy 4: Focused Context Window

### Approach
Only send the specific part of the tree the user wants to modify, with relevant context.

### Implementation
```typescript
interface FocusedContext {
  target: {
    tpl: SimplifiedTpl;
    ancestors: SimplifiedTpl[];
    siblings: SimplifiedTpl[];
  };
  relatedComponents: Component[];
  usedTokens: StyleToken[];
  activeVariants: Variant[];
}

function getFocusedContext(selection: TplNode): FocusedContext {
  return {
    target: {
      tpl: simplify(selection),
      ancestors: getAncestors(selection).map(simplify),
      siblings: getSiblings(selection).map(simplify)
    },
    relatedComponents: findReferencedComponents(selection),
    usedTokens: extractUsedTokens(selection),
    activeVariants: getCurrentVariants()
  };
}
```

### Pros
- Efficient token usage
- Relevant information only
- Faster AI processing
- Maintains relationships

### Cons
- May miss global optimization opportunities
- Requires smart context selection

## Strategy 5: Visual + Structural Hybrid

### Approach
Combine visual description (what it looks like) with structural data (how it's built).

### Implementation
```typescript
interface VisualContext {
  screenshot: string; // base64 or description
  structure: {
    dom: SimplifiedDOM;
    styles: ComputedStyles;
    interactions: InteractionMap;
  };
  annotations: {
    problems: string[];
    suggestions: string[];
    metrics: DesignMetrics;
  };
}
```

### Pros
- Rich context for AI
- Supports visual reasoning
- Can identify design issues

### Cons
- Requires screenshot/visual analysis
- More complex implementation

## Strategy 6: Diff-Based Context

### Approach
Track what the user has changed and provide before/after context.

### Implementation
```typescript
interface DiffContext {
  original: SimplifiedTpl;
  current: SimplifiedTpl;
  changes: Change[];
  intent: string; // inferred from changes
}

function trackChanges(before: TplNode, after: TplNode): DiffContext {
  return {
    original: simplify(before),
    current: simplify(after),
    changes: computeDiff(before, after),
    intent: inferIntent(changes)
  };
}
```

### Pros
- Helps AI understand user intent
- Efficient for iterative improvements
- Good for learning patterns

### Cons
- Requires change tracking
- Limited to modification scenarios

## Recommended Approach: Layered Context

Combine multiple strategies based on the use case:

```typescript
interface LayeredContext {
  // Layer 1: Immediate context (always included)
  selection: {
    simplified: SimplifiedTpl;
    html: string;
    parentContext: SimplifiedTpl;
  };
  
  // Layer 2: Semantic understanding (for improvements)
  semantics?: {
    purpose: string;
    patterns: DetectedPattern[];
    issues: DesignIssue[];
  };
  
  // Layer 3: Full context (for complex operations)
  full?: {
    component: Component;
    relatedTokens: StyleToken[];
    variants: Variant[];
  };
}

// Usage in prompt
function buildPrompt(action: string, context: LayeredContext): string {
  switch (action) {
    case "improve-accessibility":
      return `Given this UI element: ${context.selection.html}
              Purpose: ${context.semantics.purpose}
              Issues: ${context.semantics.issues}
              Suggest accessibility improvements.`;
              
    case "refactor-component":
      return `Component structure: ${JSON.stringify(context.full.component)}
              Identify opportunities to extract reusable components.`;
              
    case "optimize-styles":
      return `Current styles: ${context.selection.simplified.styles}
              Design tokens available: ${context.full.relatedTokens}
              Suggest how to use tokens instead of hard-coded values.`;
  }
}
```

## Implementation Guidelines

### 1. Context Size Management
```typescript
const MAX_CONTEXT_TOKENS = 4000;

function truncateContext(context: any): any {
  const size = estimateTokens(context);
  if (size > MAX_CONTEXT_TOKENS) {
    // Progressive simplification
    return simplifyContext(context);
  }
  return context;
}
```

### 2. Caching Strategy
```typescript
const contextCache = new Map<string, ProcessedContext>();

function getContext(tpl: TplNode): ProcessedContext {
  const key = getCacheKey(tpl);
  if (!contextCache.has(key)) {
    contextCache.set(key, processContext(tpl));
  }
  return contextCache.get(key);
}
```

### 3. Smart Serialization
```typescript
function simplifyTpl(tpl: TplNode): SimplifiedTpl {
  return {
    type: tpl.__type,
    tag: isTplTag(tpl) ? tpl.tag : undefined,
    // Only include non-default values
    styles: getNonDefaultStyles(tpl),
    // Summarize children instead of full recursion
    childCount: tpl.children?.length || 0,
    childTypes: summarizeChildren(tpl.children)
  };
}
```

## Conclusion

The best approach depends on the specific copilot action:
- **Quick improvements**: Use HTML/CSS conversion
- **Structural changes**: Use semantic descriptions
- **Complex refactoring**: Use full model with smart truncation
- **Iterative improvements**: Use diff-based context
- **General purpose**: Use layered context approach

The key is to provide just enough context for the AI to make intelligent suggestions without overwhelming it with unnecessary details.
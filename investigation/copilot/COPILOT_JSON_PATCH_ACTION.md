# JSON Patch-Based Copilot Action for Plasmic

## Overview

This document outlines how to implement a JSON Patch-based copilot action that can suggest and apply improvements to Plasmic designs.

## Architecture

### 1. Action Schema

```typescript
// In prompt-utils.ts
const CopilotImproveActionSchema = z.object({
  name: z.literal("improve-design"),
  data: z.object({
    rationale: z.string(),
    suggestions: z.array(z.string()).max(12),
    patches: z.array(PlasmicPatch).max(50),
    preview: z.object({
      before: z.string(), // HTML snapshot
      after: z.string(),  // HTML preview
    }).optional()
  })
});

const PlasmicPatch = z.object({
  op: z.enum(["setStyle", "setAttribute", "setText", "changeTag", "wrapIn", "addClass"]),
  target: z.object({
    selector: z.string(), // CSS selector or __iid
    variantCombo?: z.array(z.string()) // Target specific variants
  }),
  value: z.any(),
  field: z.string().optional() // For setStyle/setAttribute
});
```

### 2. Context Extraction

```typescript
interface ImprovementContext {
  // Simplified representation for LLM
  structure: {
    type: string;
    tag?: string;
    text?: string;
    styles: Record<string, string>;
    attrs: Record<string, string>;
    children?: ImprovementContext[];
    id: string; // __iid for targeting
  };
  
  // Additional context
  meta: {
    isHeader?: boolean;
    isHero?: boolean;
    hasAccessibilityIssues?: string[];
    usesDesignTokens?: boolean;
  };
}

function extractImprovementContext(
  tpl: TplNode,
  vtm: VariantTplMgr
): ImprovementContext {
  const vs = vtm.ensureBaseVariantSetting(tpl);
  const computedStyles = computeDefinedStyles(vs.rs, tpl);
  
  return {
    structure: {
      type: tpl.__type,
      tag: isTplTag(tpl) ? tpl.tag : undefined,
      text: vs.text ? extractText(vs.text) : undefined,
      styles: computedStyles,
      attrs: extractAttrs(vs.attrs),
      children: tpl.children?.map(c => extractImprovementContext(c, vtm)),
      id: tpl.__iid
    },
    meta: {
      isHeader: detectIfHeader(tpl),
      hasAccessibilityIssues: checkAccessibility(tpl),
      usesDesignTokens: checkTokenUsage(vs)
    }
  };
}
```

### 3. Patch Application

```typescript
async function applyImprovementPatches(
  patches: PlasmicPatch[],
  viewCtx: ViewCtx
): Promise<void> {
  viewCtx.change(() => {
    const vtm = viewCtx.variantTplMgr();
    
    for (const patch of patches) {
      const targets = findTargets(patch.target, viewCtx);
      
      for (const tpl of targets) {
        switch (patch.op) {
          case "setStyle":
            applyStylePatch(tpl, patch.field!, patch.value, vtm, patch.target.variantCombo);
            break;
            
          case "setAttribute":
            applyAttributePatch(tpl, patch.field!, patch.value, vtm);
            break;
            
          case "setText":
            applyTextPatch(tpl, patch.value, vtm);
            break;
            
          case "changeTag":
            if (isTplTag(tpl)) {
              tpl.tag = patch.value;
              // Handle tag-specific migrations (e.g., button -> a)
              migrateTagSpecificAttributes(tpl, patch.value, vtm);
            }
            break;
            
          case "wrapIn":
            const wrapper = mkTplTagX(patch.value.tag || "div", {
              styles: patch.value.styles || {}
            });
            viewOps.wrapInTag(tpl, wrapper);
            break;
            
          case "addClass":
            addClassName(tpl, patch.value, vtm);
            break;
        }
      }
    }
  });
}

function applyStylePatch(
  tpl: TplNode,
  property: string,
  value: any,
  vtm: VariantTplMgr,
  variantCombo?: string[]
) {
  const combo = variantCombo 
    ? findVariantCombo(vtm, variantCombo)
    : vtm.getTargetVariantComboForNode(tpl);
    
  const vs = vtm.ensureVariantSetting(tpl, combo);
  const rsh = RSH(vs.rs, tpl);
  
  if (value === null) {
    rsh.clear(property);
  } else {
    rsh.set(property, value);
  }
}
```

### 4. LLM Prompt Template

```typescript
const IMPROVEMENT_PROMPT = `
You are a UI improvement assistant for Plasmic. Analyze the provided component and suggest improvements.

ALLOWED OPERATIONS:
- setStyle: Change CSS properties
- setAttribute: Add/change HTML attributes
- setText: Update text content
- changeTag: Change HTML tag (with appropriate migrations)
- wrapIn: Wrap elements in containers
- addClass: Add CSS classes

IMPROVEMENT AREAS:
1. Accessibility: semantic HTML, ARIA labels, focus management
2. Responsive Design: fluid typography, flexible layouts
3. Performance: reduce redundant styles, use design tokens
4. Copy: clear, concise, action-oriented text
5. Best Practices: proper heading hierarchy, button vs link usage

CONSTRAINTS:
- Never change element IDs (id field)
- Preserve component structure
- Maintain variant relationships
- Use design tokens when available

INPUT FORMAT:
{
  "structure": { /* component tree */ },
  "meta": { /* additional context */ },
  "designTokens": { /* available tokens */ }
}

OUTPUT FORMAT:
{
  "rationale": "Brief explanation of improvements",
  "suggestions": ["Human-readable suggestions"],
  "patches": [
    {
      "op": "setStyle",
      "target": { "selector": "#elementId" },
      "field": "fontSize",
      "value": "clamp(1rem, 2vw, 1.25rem)"
    }
  ]
}
`;
```

### 5. Integration with Copilot

```typescript
// In CopilotUiPrompt.tsx
case "improve-design": {
  const viewCtx = studioCtx.focusedViewCtx();
  const selection = viewCtx.focusedTplOrSlotSelection();
  
  if (!selection) {
    notification.error({ message: "Please select an element to improve" });
    return;
  }
  
  // Extract context
  const context = extractImprovementContext(
    selection,
    viewCtx.variantTplMgr()
  );
  
  // Get design tokens
  const tokens = studioCtx.site.styleTokens;
  
  // Send to LLM
  const improvements = await callLLMForImprovements(context, tokens);
  
  // Show preview dialog
  const accepted = await showImprovementDialog(improvements);
  
  if (accepted) {
    await applyImprovementPatches(improvements.patches, viewCtx);
  }
  break;
}
```

### 6. Safety Guards

```typescript
class PatchValidator {
  static validate(patch: PlasmicPatch, tpl: TplNode): ValidationResult {
    // Check if operation is allowed on this node type
    if (patch.op === "changeTag" && !isTplTag(tpl)) {
      return { valid: false, reason: "Cannot change tag on components" };
    }
    
    // Validate style values
    if (patch.op === "setStyle") {
      const validation = validateCssValue(patch.field!, patch.value);
      if (!validation.valid) {
        return validation;
      }
    }
    
    // Check variant compatibility
    if (patch.target.variantCombo) {
      const variantsExist = patch.target.variantCombo.every(v => 
        findVariantByName(tpl, v)
      );
      if (!variantsExist) {
        return { valid: false, reason: "Invalid variant specified" };
      }
    }
    
    return { valid: true };
  }
}
```

## Example Improvements

### 1. Accessibility Enhancement
```json
{
  "patches": [
    {
      "op": "changeTag",
      "target": { "selector": ".hero-container" },
      "value": "header"
    },
    {
      "op": "setAttribute",
      "target": { "selector": ".hero-container" },
      "field": "role",
      "value": "banner"
    },
    {
      "op": "setAttribute",
      "target": { "selector": ".cta-button" },
      "field": "aria-label",
      "value": "Get started with our product"
    }
  ]
}
```

### 2. Responsive Typography
```json
{
  "patches": [
    {
      "op": "setStyle",
      "target": { "selector": "h1" },
      "field": "fontSize",
      "value": "clamp(2rem, 5vw, 3.5rem)"
    },
    {
      "op": "setStyle",
      "target": { "selector": "p" },
      "field": "maxWidth",
      "value": "65ch"
    }
  ]
}
```

### 3. Design Token Usage
```json
{
  "patches": [
    {
      "op": "setStyle",
      "target": { "selector": ".card" },
      "field": "padding",
      "value": "var(--spacing-lg)"
    },
    {
      "op": "setStyle",
      "target": { "selector": ".card" },
      "field": "backgroundColor",
      "value": "var(--color-surface)"
    }
  ]
}
```

## Benefits

1. **Safe Operations**: All patches go through Plasmic's change management
2. **Variant-Aware**: Can target specific responsive/state variants
3. **Reviewable**: Clear list of changes before applying
4. **Extensible**: Easy to add new operation types
5. **LLM-Friendly**: Structured format that LLMs can reliably generate

This approach provides a robust foundation for AI-powered design improvements while respecting Plasmic's architecture and safety requirements.
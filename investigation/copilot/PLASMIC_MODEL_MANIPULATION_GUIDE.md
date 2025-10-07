# Plasmic Model Manipulation Guide for Copilot Actions

## Overview

This guide explains how to create copilot actions that directly modify Plasmic's data model, going beyond the current HTML-based approach.

## Core Data Model

### 1. **Node Types (TplNode)**

```typescript
// Base types
TplTag        // HTML elements (div, span, etc.)
TplComponent  // Component instances
TplSlot       // Slots for content projection
RawText       // Text content with rich formatting
```

### 2. **Model Structure**

According to Plasmic's official documentation, the model follows this hierarchy:

```typescript
// Complete model hierarchy
Site {
  components: Component[]      // All pages and reusable components
  splits: Split[]             // A/B tests, custom targets, scheduled content
  globalVariants: Variant[]    // Site-wide variants (themes, locales)
  styleTokens: StyleToken[]    // Design tokens (colors, fonts, spacings)
  mixins: Mixin[]             // Reusable style sets
  projectSettings: Settings    // Project configuration
}

Component {
  name: string
  type: "page" | "plain" | "code"
  tplTree: TplNode            // Root of the component's element tree
  variants: Variant[]         // Component-specific variants
  params: Param[]             // Component props/parameters
  vsettings: VariantSetting[] // Variant-specific settings
}

TplNode {
  __type: string              // "TplTag" | "TplComponent" | "TplSlot"
  __iid: string              // Internal ID (unique identifier)
  parent?: TplNode           // Parent reference
  vsettings: VariantSetting[] // Styles and settings per variant combo
}
```

### 3. **Key Concepts**

- **VariantSetting (vsettings)**: Where all styles, attributes, and prop settings are stored for specific variant combinations
- **Internal IDs (__iid)**: Every object has a unique internal ID for tracking
- **Args**: Component props, including slot arguments (can contain children prop values)
- **VariantCombo**: Active combination of variants (e.g., base + mobile + hover)
- **RSH (RuleSetHelper)**: API for manipulating CSS styles
- **Splits**: Metadata for optimization features (A/B tests, scheduled content)

## Creating a Custom Copilot Action

### Step 1: Define Action Schema

```typescript
// In prompt-utils.ts
const CopilotModelModifyActionSchema = z.object({
  name: z.literal("modify-model"),
  data: z.object({
    operation: z.enum(["add", "update", "remove", "wrap"]),
    target: z.object({
      selector: z.string(), // CSS selector or component name
      index: z.number().optional()
    }),
    changes: z.object({
      styles: z.record(z.string()).optional(),
      attributes: z.record(z.string()).optional(),
      content: z.string().optional(),
      children: z.array(z.any()).optional()
    })
  })
});
```

### Step 2: Update LLM Prompt

```typescript
// In ui-copilot-chain.ts
const COPILOT_ACTIONS_PROMPT = `
...existing actions...

3. modify-model: Direct model manipulation
   - operation: "add" | "update" | "remove" | "wrap"
   - target: selector and optional index
   - changes: styles, attributes, content, or children

Example:
{
  "name": "modify-model",
  "data": {
    "operation": "update",
    "target": { "selector": ".hero-section" },
    "changes": {
      "styles": {
        "backgroundColor": "#000",
        "padding": "40px"
      }
    }
  }
}
`;
```

### Step 3: Implement Action Handler

```typescript
// In CopilotUiPrompt.tsx or similar
case "modify-model": {
  await handleModelModification(action.data, studioCtx);
  break;
}

async function handleModelModification(
  data: ModelModifyAction,
  studioCtx: StudioCtx
) {
  studioCtx.change(() => {
    const viewCtx = studioCtx.focusedViewCtx();
    const vtm = viewCtx.variantTplMgr();
    
    // Find target nodes
    const targets = findNodesBySelector(data.target.selector, viewCtx);
    
    switch (data.operation) {
      case "update":
        targets.forEach(tpl => {
          if (data.changes.styles) {
            updateNodeStyles(tpl, data.changes.styles, vtm);
          }
          if (data.changes.attributes) {
            updateNodeAttributes(tpl, data.changes.attributes, vtm);
          }
          if (data.changes.content && isTplTextBlock(tpl)) {
            updateTextContent(tpl, data.changes.content, vtm);
          }
        });
        break;
        
      case "add":
        const parent = targets[0];
        const newNode = createNodeFromChanges(data.changes);
        viewOps.insertAsChild(newNode, parent);
        break;
        
      case "remove":
        targets.forEach(tpl => viewOps.deleteNode(tpl));
        break;
        
      case "wrap":
        const wrapper = mkTplTagX("div", { 
          styles: data.changes.styles || {} 
        });
        targets.forEach(tpl => viewOps.wrapInTag(tpl, wrapper));
        break;
    }
  });
}
```

### Step 4: Helper Functions

```typescript
function updateNodeStyles(
  tpl: TplNode,
  styles: Record<string, string>,
  vtm: VariantTplMgr
) {
  const vs = vtm.ensureVariantSetting(tpl);
  const rsh = RSH(vs.rs, tpl);
  
  Object.entries(styles).forEach(([prop, value]) => {
    rsh.set(prop, value);
  });
}

function findNodesBySelector(
  selector: string,
  viewCtx: ViewCtx
): TplNode[] {
  const root = viewCtx.tplTreeRoot();
  
  // Simple implementation - extend as needed
  if (selector.startsWith(".")) {
    const className = selector.slice(1);
    return findTplNodesWithClass(root, className);
  } else if (selector.startsWith("#")) {
    const id = selector.slice(1);
    return [findTplNodeById(root, id)].filter(Boolean);
  } else {
    // Tag name
    return findTplNodesByTag(root, selector);
  }
}
```

## Advanced Model Operations

### 1. **Component Creation**

```typescript
// Create a new component
const component = tplMgr.addComponent({
  type: ComponentType.Plain,
  name: "MyButton"
});

// Add to component tree
const root = mkTplTagX("button", {
  styles: { padding: "10px 20px" }
});
component.tplTree = root;
```

### 2. **Variant Management**

```typescript
// Create a new variant
const hoverVariant = tplMgr.addVariant(component, "hover", "Style");

// Add variant-specific styling
const vs = ensureVariantSetting(tpl, [baseVariant, hoverVariant]);
RSH(vs.rs, tpl).set("backgroundColor", "#0066cc");
```

### 3. **Responsive Design**

```typescript
// Get screen variants
const screenVariants = getSiteScreenVariants(site);
const mobileVariant = screenVariants.find(v => v.name === "Mobile");

// Add mobile-specific styles
const mobileVs = ensureVariantSetting(tpl, [baseVariant, mobileVariant]);
RSH(mobileVs.rs, tpl).set("fontSize", "14px");
```

### 4. **Data Binding**

```typescript
// Create dynamic expression
const expr = new CustomCode({
  code: "props.title || 'Default Title'",
  fallback: codeLit("Default Title")
});

// Bind to text content
const vs = ensureVariantSetting(tpl, baseVariant);
vs.text = new ExprText({ expr, html: false });
```

## Best Practices

1. **Always Use change()**
   ```typescript
   studioCtx.change(() => {
     // All model mutations here
   });
   ```

2. **Respect Current Variant Context**
   ```typescript
   const targetCombo = vtm.getTargetVariantComboForNode(tpl);
   const vs = ensureVariantSetting(tpl, targetCombo);
   ```

3. **Validate Before Modifying**
   ```typescript
   if (isKnownTplTag(tpl) && !isCodeComponent(tpl)) {
     // Safe to modify
   }
   ```

4. **Handle Component Boundaries**
   ```typescript
   if (isTplComponent(tpl)) {
     // Cannot modify internals directly
     // Must work through component props/slots
   }
   ```

5. **Maintain Tree Integrity**
   ```typescript
   // Always update parent pointers
   newNode.parent = parentNode;
   parentNode.children.push(newNode);
   ```

## Example: Smart Layout Copilot Action

```typescript
// Action that converts a list to a grid layout
const ConvertToGridAction = {
  name: "convert-to-grid",
  data: {
    selector: ".product-list",
    columns: 3,
    gap: "20px"
  }
};

function handleConvertToGrid(data, studioCtx: StudioCtx) {
  studioCtx.change(() => {
    const viewCtx = studioCtx.focusedViewCtx();
    const vtm = viewCtx.variantTplMgr();
    
    const container = findNodeBySelector(data.selector, viewCtx);
    if (!container) return;
    
    // Update container to grid
    const vs = vtm.ensureVariantSetting(container);
    const rsh = RSH(vs.rs, container);
    
    rsh.set("display", "grid");
    rsh.set("gridTemplateColumns", `repeat(${data.columns}, 1fr)`);
    rsh.set("gap", data.gap);
    
    // Update children to remove flex-specific styles
    container.children.forEach(child => {
      const childVs = vtm.ensureVariantSetting(child);
      const childRsh = RSH(childVs.rs, child);
      childRsh.clear("flexBasis");
      childRsh.clear("flexGrow");
    });
  });
}
```

## Debugging Tips

1. **Inspect Model Structure**
   ```typescript
   console.log("TplNode:", tpl);
   console.log("Variant Settings:", tpl.vsettings);
   console.log("Current Variants:", vtm.getActivatedVariants());
   ```

2. **Trace Changes**
   ```typescript
   studioCtx.recorder.withRecording(() => {
     // Changes here will be tracked
   });
   ```

3. **Validate Operations**
   ```typescript
   try {
     viewOps.insertAsChild(newNode, parent);
   } catch (e) {
     console.error("Invalid insertion:", e);
   }
   ```

This guide provides the foundation for creating sophisticated copilot actions that directly manipulate Plasmic's model while maintaining consistency with the visual editor.

## Additional Resources

### Official Documentation
- **Model API**: The raw JSON representation of Plasmic projects
- **Model Renderer**: React integration using the Model API  
- **Project IDs**: Access via "Code" button in Plasmic Studio toolbar

### Understanding the Bundled Data
When you see revision data like:
```json
{
  "root": "BVRvtjyrrOU4",
  "map": {
    "ztOo9w7dVFH5": {
      "__type": "RawText",
      "text": "test"
    }
  }
}
```

- `root`: The __iid of the root component
- `map`: Object containing all changed/new instances indexed by __iid
- `__type`: The class type of each object
- References between objects use `__ref` (internal) or `__xref` (external)

### Model API vs Generated Code
- **Model API**: Returns raw JSON, requires Model Renderer
- **Generated Code**: Pre-built React components
- Copilot actions work with the Model API format internally
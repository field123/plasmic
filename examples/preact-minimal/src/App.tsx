import {
  initPlasmicLoader,
  PlasmicComponent,
  PlasmicRootProvider,
} from "@plasmicapp/loader-react";

const LOADER = initPlasmicLoader({
  projects: [
    {
      id: "cVdoa5dDiYwQKr4Wff9Y8G",
      token:
        "2lfArIVEOaOXqHE44CFFZoEsYKA8fAot6TIYv2pf9uT7rebEADz89LLIk7LDkkr4Az1OYB9TqSKivpHFqDg",
    },
  ],
  host: "http://localhost:3003",
});

export function App() {
  return (
    <PlasmicRootProvider loader={LOADER}>
      <PlasmicComponent
        component="/test"
        componentProps={{ title: "Minimal Preact app" }}
      />
    </PlasmicRootProvider>
  );
}

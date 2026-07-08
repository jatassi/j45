import { RegistryProvider } from "@effect-atom/atom-react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </RegistryProvider>
  </StrictMode>
)

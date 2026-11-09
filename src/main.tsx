import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initDesktop } from "./desktop";

initDesktop();
createRoot(document.getElementById("root")!).render(<App />);

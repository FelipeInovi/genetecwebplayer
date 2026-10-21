import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GenetecPage from "@/render/pages/Genetec/GenetecPage";

const theme = createTheme({ palette: { mode: "dark" } });
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } }
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GenetecPage />
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

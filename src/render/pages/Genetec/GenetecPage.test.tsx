import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/render/locales/i18n";
import GenetecPage from "@/render/pages/Genetec/GenetecPage";

describe("GenetecPage (smoke)", () => {
  it("renders the title and the mosaic with mock cameras", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <GenetecPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Genetec Web Player/)).toBeInTheDocument();
    expect(
      await screen.findByText("32 cámaras", { exact: false })
    ).toBeInTheDocument();
    expect(await screen.findAllByTestId("player-container")).toHaveLength(4);
  });
});

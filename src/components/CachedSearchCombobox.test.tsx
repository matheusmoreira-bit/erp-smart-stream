import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";

describe("CachedSearchCombobox", () => {
  it("permite selecionar uma opcao em cache enquanto a lista revalida", () => {
    const onChange = vi.fn();

    render(
      <CachedSearchCombobox
        label="Fornecedor *"
        options={[{ code: "F001", name: "OBVIO BRASIL SOFTWARE E SERVICOS S.A." }]}
        isLoading
        value={null}
        onChange={onChange}
        suggestedQuery="OBVIO BRASIL SOFTWARE E SERVICOS S.A."
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).not.toBeDisabled();

    fireEvent.mouseDown(screen.getByRole("button", { name: /OBVIO BRASIL SOFTWARE/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ code: "F001" }));
  });
});

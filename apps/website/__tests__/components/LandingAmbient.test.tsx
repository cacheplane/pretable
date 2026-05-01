import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { LandingAmbient } from "../../app/components/LandingAmbient";

afterEach(() => {
  cleanup();
});

it("renders six blob children inside an aria-hidden wrapper", () => {
  const { container } = render(<LandingAmbient />);
  const wrapper = container.querySelector('[aria-hidden="true"]');
  expect(wrapper).toBeInTheDocument();
  // The six blobs are absolutely-positioned children of the wrapper.
  expect(wrapper?.children.length).toBe(6);
});

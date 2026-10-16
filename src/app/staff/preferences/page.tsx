import type { Metadata } from "next";
import Preferences from "./Preferences";

export const metadata: Metadata = {
  // The dates live in the data now, so they're shown under the heading rather
  // than baked into the title.
  title: "Open shifts",
};

export default function PreferencesPage() {
  return <Preferences />;
}

import type { ExperimentalPanelController } from "@get-bb/plugin-sdk/app";

export const testPanelController: ExperimentalPanelController = {
  openTab: () => false,
  getTabs: () => ({ open: false, selectedKey: null, tabs: [] }),
  selectTab: () => false,
  closeTab: () => false,
  toggleTab: () => false,
  close: () => false,
};

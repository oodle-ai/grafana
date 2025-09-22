import { VizPanel, VizPanelState } from "@grafana/scenes";

import { useDeferredSceneObjectState } from "./utils";

export class DeferredVizPanel extends VizPanel {
  public useState(): VizPanelState {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useDeferredSceneObjectState(this);
  }
}

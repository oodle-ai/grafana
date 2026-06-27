import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { config } from '@grafana/runtime';
import { SceneTimeRange, VizPanel } from '@grafana/scenes';

import { DashboardScene } from '../../scene/DashboardScene';
import { DefaultGridLayoutManager } from '../../scene/layout-default/DefaultGridLayoutManager';

import ExportMenu from './ExportMenu';

describe('ExportMenu', () => {
  beforeEach(() => {
    config.featureToggles.sharingDashboardImage = false;
    config.rendererAvailable = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should render menu items', async () => {
    setup();
    expect(await screen.findByRole('menuitem', { name: /export as json/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /print/i })).toBeInTheDocument();
  });

  it('should trigger the browser print dialog after the menu has had a chance to close', async () => {
    const printSpy = jest.spyOn(window, 'print').mockImplementation(() => {});
    const requestAnimationFrameSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    setup();
    await userEvent.click(await screen.findByRole('menuitem', { name: /print/i }));

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  describe('sharingDashboardImage feature toggle', () => {
    it('should render image export option when enabled and the image renderer is available', async () => {
      config.featureToggles.sharingDashboardImage = true;
      config.rendererAvailable = true;
      setup();
      expect(await screen.findByRole('menuitem', { name: /export as image/i })).toBeInTheDocument();
    });

    it('should not render image export option when disabled', async () => {
      config.featureToggles.sharingDashboardImage = false;
      config.rendererAvailable = true;
      setup();
      expect(screen.queryByRole('menuitem', { name: /export as image/i })).not.toBeInTheDocument();
    });

    it('should not render image export option when the image renderer is not available', async () => {
      config.featureToggles.sharingDashboardImage = true;
      config.rendererAvailable = false;
      setup();
      expect(screen.queryByRole('menuitem', { name: /export as image/i })).not.toBeInTheDocument();
    });
  });
});

function setup() {
  const panel = new VizPanel({
    title: 'Panel A',
    pluginId: 'table',
    key: 'panel-12',
  });

  const dashboard = new DashboardScene({
    title: 'hello',
    uid: 'dash-1',
    $timeRange: new SceneTimeRange({}),
    body: DefaultGridLayoutManager.fromVizPanels([panel]),
  });

  render(<ExportMenu dashboard={dashboard} />);
}

import { useGrafana } from 'app/core/context/GrafanaContext';

import {SingleTopBar} from "../../core/components/AppChrome/TopBar/SingleTopBar";
import {CommandPalette} from "../commandPalette/CommandPalette";

export default function SearchNavPage() {
  const { chrome } = useGrafana();
  const state = chrome.useState();
  return (
    <>
      <SingleTopBar
        sectionNav={state.sectionNav.node}
        pageNav={state.pageNav}
      />
      <CommandPalette />
    </>
  );
}

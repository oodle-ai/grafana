import { css, cx } from '@emotion/css';
import {useRef, useState, useEffect } from 'react';
import { useDebounce } from 'react-use';

import { GrafanaTheme2, PanelProps, dateTime } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { defaultOptions, Options } from './panelcfg.gen';

export interface Props extends PanelProps<Options> { }

const openSearchCSSMods = `
#queryLanguageSwitcherPopover,
.euiListGroupItem__label[title="Overview"],
a[data-test-subj="docTableRowAction-0"],
a[data-test-subj="docTableRowAction-1"],
button[aria-label="Toggle primary navigation"],
div[data-test-subj="collapsibleNavGroup-recentlyViewed"],
div[data-test-subj="collapsibleNavGroup-observability"],
div[data-test-subj="collapsibleNavGroup-opensearch"],
div[data-test-subj="collapsibleNavGroup-management"] {
  display: none !important;
}

/* Hide the "home" icon on the top left */
a.header__homeLoaderNavButton {
  width: 0px !important;
  min-width: 0px !important;
  border: 0px !important;
}

/* The loading spinner used to show in place of the "home" icon.
   Move it to the top right corner instead. */
span[data-test-subj="globalLoadingIndicator"] {
  position: absolute;
  left: calc(100vw - 36px);
  top: 12px;
  width: 24px;
  height: 24px;
}

.euiBody--headerIsFixed {
  padding-top: 0px !important;
}

.primaryHeader {
    display: none;
    height: 0px !important;
}

.osdOverviewPageHeader__actionItem:last-child {
  display: none;
}

.deLayout {
  height: 100% !important;
}
`
export function TextPanel(props: Props) {
  const styles = useStyles2(getStyles);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [processed, setProcessed] = useState<Options>({
    content: (props.options?.content?.length ?? 0) > 0 ? (props.options?.content || '') : defaultOptions.content || '',
  });
  const [lastUrl, setLastUrl] = useState<string>(processed.content);

  const [iframeUrl, setIFrameUrl] = useState(processed.content);

  // Effect to handle time range changes
  useEffect(() => {
    if (iframeRef.current && processed.content) {
      const timeRangeRegex = /time:\([^)]*\)/;
      const fromTime = dateTime(props.timeRange.from).format('YYYY-MM-DDTHH:mm:ss');
      const toTime = dateTime(props.timeRange.to).format('YYYY-MM-DDTHH:mm:ss');
      const newUrl = processed.content.replace(timeRangeRegex, `time:(from:'${fromTime}',to:'${toTime}')`);

      console.log('CHANGE');
      console.log(processed.content);
      console.log(timeRangeRegex);
      console.log(`time:(from:'${fromTime}',to:'${toTime}')`);
      console.log(newUrl);

      if (newUrl !== processed.content) {
        setProcessed({ content: newUrl });
        setIFrameUrl(newUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.timeRange.from, props.timeRange.to]);

  useDebounce(
    () => {
      const content = (props.options?.content?.length ?? 0) > 0 ? (props.options?.content || '') : defaultOptions.content || '';
      if (content !== processed.content) {
        setProcessed({
          content,
        });
      }
    },
    100,
    [props]
  );

  const mutationObserverRef = useRef<MutationObserver | undefined>(
    undefined
  );

  const injectLocationCallback = () => {
    const iframe = iframeRef.current;
    if (!iframe) { return; }

    injectCSS(iframe, openSearchCSSMods);

    if (mutationObserverRef.current) {
      mutationObserverRef.current.disconnect();
      mutationObserverRef.current = undefined;
    }

    mutationObserverRef.current = setupLocationChangeCallback(
      iframe,
      (iframe: HTMLIFrameElement) => {
        if (typeof window === 'undefined') {
          return;
        }

        if (iframe.contentWindow) {
          const currentIFrameURL = iframe.contentWindow?.location?.href;
          if (currentIFrameURL !== lastUrl) {
            // Replace time range in URL with actual time range
            // const timeRangeRegex = /time:\([^)]*\)/;
            // const fromTime = dateTime(props.timeRange.from).format('YYYY-MM-DDTHH:mm:ss');
            // const toTime = dateTime(props.timeRange.to).format('YYYY-MM-DDTHH:mm:ss');
            // const newUrl = currentIFrameURL.replace(timeRangeRegex, `time:(from:${fromTime},to:${toTime})`);
            //
            // console.log('CHANGE');
            // console.log(currentIFrameURL);
            // console.log(timeRangeRegex);
            // console.log(`time:(from:${fromTime},to:${toTime})`);

            setLastUrl(currentIFrameURL);
            props.onOptionsChange({
              ...props.options,
              content: currentIFrameURL,
            });
          }
        }
      });
  }

  const onLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    injectLocationCallback();
  };

  return (
    <iframe
      id={"OodleLogs"}
      key={iframeUrl}
      title="OodleLogs"
      allow="clipboard-read; clipboard-write"
      ref={iframeRef}
      width="100%"
      height="100%"
      src={iframeUrl}
      className={styles.markdown}
      data-testid="TextPanel-converted-content"
      onLoad={onLoad}
    />
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  codeEditorContainer: css`
    .monaco-editor .margin,
    .monaco-editor-background {
      background-color: ${theme.colors.background.primary};
    }
  `,
  markdown: cx(
    css`
      height: 100%;
      border: none !important;
    `
  ),
  containStrict: css({
    contain: 'strict',
  }),
});

function setupLocationChangeCallback(
  iframe: HTMLIFrameElement,
  locationChangeCallback: (iframe: HTMLIFrameElement) => void
): MutationObserver | undefined {
  const doc = iframe.contentDocument;
  const location = iframe.contentDocument?.location;
  if (!doc || !location) {
    console.log('EARLY EXIT');
    return undefined;
  }

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      locationChangeCallback(iframe);
      lastUrl = url;
    }
  });
  observer.observe(doc, { subtree: true, childList: true });
  return observer;
}

export function injectCSS(iframe: HTMLIFrameElement, css?: string) {
  // UUID to identify the injected element, to avoid any conflicts with
  // actual ID any HTML element might have.
  const styleID = '277f78d1-06cc-4b3e-9c5a-5c537ad976ac';

  if (!css) {return;}

  const doc = iframe.contentDocument;
  if (!doc) {return;}

  let oldCSS = doc.getElementById(styleID);
  if (oldCSS) {
    if (oldCSS.textContent === css) {return;}
    oldCSS.remove();
  }

  const style = doc.createElement('style');
  style.id = styleID;
  style.appendChild(doc.createTextNode(css));
  doc.head?.appendChild(style);
}


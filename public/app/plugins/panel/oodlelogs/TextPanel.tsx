import { css, cx } from '@emotion/css';
import {useRef, useState, useEffect } from 'react';
import { useDebounce } from 'react-use';

import { GrafanaTheme2, PanelProps, dateTime } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { defaultOptions, Options } from './panelcfg.gen';

export interface Props extends PanelProps<Options> { }

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
    'markdown-html',
    css`
      height: 100%;
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

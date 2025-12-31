import { useState } from "react";

import { Field, LinkModel } from "@grafana/data";

import { getCellLinks } from '../../utils/table';

import { TableCellInspector, TableCellInspectorMode } from "./TableCellInspector";
import { TableCellProps } from './types';

interface InspectableDataLinkCellProps {
  field: Field;
  rowIdx: number;
  links: Array<LinkModel<unknown>> | undefined;
}

// Shared core component used by both TableRT and TableNG
export const InspectableDataLinkCell = ({ field, rowIdx, links }: InspectableDataLinkCellProps) => {
  const [isInspecting, setIsInspecting] = useState(false);

  if (!links?.length) {
    return null;
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsInspecting(true);
        }}
      >
        {field.values[rowIdx]}
      </a>

      {isInspecting && (
        <TableCellInspector
          mode={TableCellInspectorMode.code}
          value={decodeURI(links[0]?.href || '')}
          onDismiss={() => setIsInspecting(false)}
        />
      )}
    </>
  );
};

// TableRT wrapper that adapts TableCellProps to the shared component
export const InspectableDataLinkCellRT = (props: TableCellProps) => {
  const { field, row, cellProps, tableStyles } = props;
  const links = getCellLinks(field, row);

  return (
    <div {...cellProps} className={tableStyles.cellContainerText}>
      <InspectableDataLinkCell field={field} rowIdx={row.index} links={links} />
    </div>
  );
};

import { createContext, useContext } from 'react';

export const ShowAllTimeSeriesContext = createContext<boolean>(false);

export function useShowAllTimeSeries(): boolean {
  return useContext(ShowAllTimeSeriesContext);
}

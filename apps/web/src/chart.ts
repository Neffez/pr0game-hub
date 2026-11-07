import { Chart, Filler, Legend, LinearScale, LineController, LineElement, PointElement, ScatterController, Tooltip } from 'chart.js';

// Only what the hub's charts use (line and scatter charts on linear axes, legend, tooltips, filled areas): the whole
// `registerables` set would ship every chart type and scale.
Chart.register(LineController, ScatterController, LineElement, PointElement, LinearScale, Legend, Tooltip, Filler);

export { Chart };
export type { ChartDataset } from 'chart.js';

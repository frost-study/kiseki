import { figureTypes } from '../core/Registry.js';
import { CartesianFigure } from './CartesianFigure.js';
import './marks.js';
import './sparkline.js';
import './donut.js';
import './treemap.js';

figureTypes.register(CartesianFigure);

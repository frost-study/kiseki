import { figureTypes } from '../core/Registry.js';
import { CartesianFigure } from './CartesianFigure.js';
import './marks.js';
import './sparkline.js';

figureTypes.register(CartesianFigure);

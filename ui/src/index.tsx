import { render } from 'solid-js/web';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 容器');

render(() => <App />, root);

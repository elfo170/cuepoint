// Content script mínimo executado em document_start (antes dos scripts do SoundCloud).
import { installKeyboardGuard } from './keyboard';

installKeyboardGuard();

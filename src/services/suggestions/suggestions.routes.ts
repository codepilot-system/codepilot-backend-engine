import { Router } from 'express';
import {
    getAIFixSuggestion,
    getSuggestions,
    applySuggestion,
    dismissSuggestion,
    bulkApplySuggestions,
    bulkDismissSuggestions
} from './suggestions.controller';

const router = Router();

router.get('', getSuggestions);
router.get('/:suggestionId', getAIFixSuggestion);

router.post('/bulk-apply', bulkApplySuggestions);
router.post('/bulk-dismiss', bulkDismissSuggestions);

router.post('/:suggestionId/apply', applySuggestion);
router.post('/:suggestionId/dismiss', dismissSuggestion);

export default router;

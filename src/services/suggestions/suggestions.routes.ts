import { Router } from 'express';
import {
    getAIFixSuggestion,
    getSuggestions,
    applySuggestion,
    dismissSuggestion,
    bulkApplySuggestions,
    bulkDismissSuggestions,
    listSuggestionApplies,
    getSuggestionApply
} from './suggestions.controller';

const router = Router();

router.get('', getSuggestions);
router.post('/bulk-apply', bulkApplySuggestions);
router.post('/bulk-dismiss', bulkDismissSuggestions);

router.get('/applies/list', listSuggestionApplies);
router.get('/applies/:applyId', getSuggestionApply);

router.get('/:suggestionId', getAIFixSuggestion);
router.post('/:suggestionId/apply', applySuggestion);
router.post('/:suggestionId/dismiss', dismissSuggestion);

export default router;

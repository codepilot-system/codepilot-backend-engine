import { Router } from 'express';
import { getAIFixSuggestion, getSuggestions, applySuggestion, dismissSuggestion, getModelStatuses } from './ai.controller';

const router = Router();

router.get('/statuses', getModelStatuses);
router.get('/suggestions', getSuggestions);
router.get('/suggestions/:suggestionId', getAIFixSuggestion);

router.post('/suggestions/:suggestionId/apply', applySuggestion);
router.post('/suggestions/:suggestionId/dismiss', dismissSuggestion);

export default router;

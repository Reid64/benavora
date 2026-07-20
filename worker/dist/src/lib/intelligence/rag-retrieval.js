"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retrieveIntelligence = retrieveIntelligence;
exports.retrieveRubric = retrieveRubric;
exports.retrieveLogicModel = retrieveLogicModel;
exports.retrieveNeedData = retrieveNeedData;
const embeddings_1 = require("./embeddings");
const server_1 = require("@/lib/supabase/server");
const NEED_DATA_COLS = 'id, source, source_url, data_type, geographic_level, state, county, city, metric_name, metric_value, metric_year, context, citation';
const RUBRIC_COLS = 'id, source, source_url, funder_name, grant_program, category, dimensions, full_text';
async function retrieveIntelligence(params) {
    const { queryText, sectionTypes, limit = 5, threshold = 0.7, } = params;
    const embedding = await (0, embeddings_1.generateEmbedding)(queryText);
    const supabase = (0, server_1.createClient)();
    const { data, error } = await supabase.rpc('match_proposal_sections', {
        query_embedding: embedding,
        match_threshold: threshold,
        filter_section_types: sectionTypes ?? null,
        match_count: limit,
    });
    if (error)
        throw new Error(error.message);
    return (data ?? []);
}
async function retrieveRubric(params) {
    const { funderName, category } = params;
    const supabase = (0, server_1.createClient)();
    if (funderName) {
        const { data } = await supabase
            .from('intelligence_scoring_rubrics')
            .select(RUBRIC_COLS)
            .ilike('funder_name', `%${funderName}%`)
            .limit(1)
            .maybeSingle();
        if (data)
            return data;
    }
    if (category) {
        const { data } = await supabase
            .from('intelligence_scoring_rubrics')
            .select(RUBRIC_COLS)
            .contains('category', [category])
            .limit(1)
            .maybeSingle();
        if (data)
            return data;
    }
    return null;
}
async function retrieveLogicModel(category) {
    const supabase = (0, server_1.createClient)();
    const { data } = await supabase
        .from('intelligence_logic_models')
        .select('id, category, subcategory, inputs, activities, outputs, outcomes, impact, source')
        .eq('category', category)
        .limit(1)
        .maybeSingle();
    if (!data)
        return null;
    return data;
}
async function retrieveNeedData(params) {
    const { state, county, category } = params;
    const supabase = (0, server_1.createClient)();
    const results = [];
    if (county && state) {
        let q = supabase
            .from('intelligence_need_data')
            .select(NEED_DATA_COLS)
            .eq('geographic_level', 'county')
            .eq('county', county)
            .eq('state', state);
        if (category)
            q = q.eq('data_type', category);
        const { data } = await q.limit(10);
        results.push(...(data ?? []));
    }
    if (state && results.length < 10) {
        const remaining = 10 - results.length;
        let q = supabase
            .from('intelligence_need_data')
            .select(NEED_DATA_COLS)
            .eq('geographic_level', 'state')
            .eq('state', state);
        if (category)
            q = q.eq('data_type', category);
        const { data } = await q.limit(remaining);
        results.push(...(data ?? []));
    }
    if (results.length < 10) {
        const remaining = 10 - results.length;
        let q = supabase
            .from('intelligence_need_data')
            .select(NEED_DATA_COLS)
            .eq('geographic_level', 'national');
        if (category)
            q = q.eq('data_type', category);
        const { data } = await q.limit(remaining);
        results.push(...(data ?? []));
    }
    return results;
}

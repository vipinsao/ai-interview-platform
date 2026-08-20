/** Prompt templates. Kept out of the React bundle so they can be edited without touching UI code. */

export const QUESTIONS_PROMPT = `You are an expert technical interviewer.
Based on the following inputs, generate a well-structured list of high-quality interview questions.

Job Title: {{jobTitle}}
Job Description: {{jobDescription}}
Interview Duration: {{duration}}
Interview Type: {{type}}

Rules:
- Analyse the job description for key responsibilities, required skills and expected experience.
- Choose the number and depth of questions to fit the stated duration (roughly one question per three minutes).
- Every question's "type" must be one of: Technical, Behavioral, Experience, Problem Solving, Leadership.
- Respond with JSON only, in exactly this shape:
{"interviewQuestions":[{"question":"...","type":"Technical"}]}`;

export const ANSWER_SCORE_PROMPT = `You are scoring one answer from a live interview for the role of "{{jobPosition}}".

Question ({{questionType}}): {{question}}
Candidate's answer (speech transcript, so expect filler words and transcription errors): {{answer}}

Score the answer from 0 to 10 against these criteria, weighted equally:
1. Correctness and technical accuracy of the content.
2. Relevance — does it actually answer the question that was asked.
3. Depth — concrete detail, examples and trade-offs rather than generalities.
4. Clarity of explanation.

Guidance:
- Score the substance, not the grammar. Do not penalise transcription artefacts or filler words.
- An empty, off-topic or "I don't know" answer scores 0-2.
- Reserve 9-10 for an answer that is correct, specific and well structured.

Respond with JSON only, in exactly this shape:
{"score":7,"strengths":["..."],"gaps":["..."],"suggestedImprovement":"..."}`;

export const SUMMARY_PROMPT = `You are writing the closing summary of an interview for the role of "{{jobPosition}}".

Here are the questions asked and how each answer was scored out of 10:
{{scoredAnswers}}

The numeric ratings have already been computed from these scores, so do not invent or restate numbers.
Write:
- "summary": three sentences describing how the interview went.
- "recommendation": exactly one of "Yes", "No" or "Maybe".
- "recommendationMsg": one sentence justifying that recommendation.

Respond with JSON only, in exactly this shape:
{"summary":"...","recommendation":"Yes","recommendationMsg":"..."}`;

export function fillTemplate(template, values) {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.split(`{{${key}}}`).join(String(value)),
    template
  );
}

import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
    throw new Error(
        "OPENAI_API_KEY must be set. Did you forget to provision the OpenAI integration?",
    );
}

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
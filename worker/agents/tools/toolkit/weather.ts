// Simple weather tool for testing tool calling framework
import { ErrorResult, ToolDefinition } from "../types";

type WeatherArgs = {
    location: string;
};

export interface WeatherResult {
	location: string;
	temperature: number;
	condition: string;
	humidity: number;
}

type WeatherToolResult = WeatherResult | ErrorResult;

const weatherToolImplementation = async (args: WeatherArgs): Promise<WeatherToolResult> => {
    try {
        return {
            location: args.location,
            temperature: Math.floor(Math.random() * 40) - 10,
            condition: ['Sunny', 'Cloudy', 'Rainy', 'Snowy'][
                Math.floor(Math.random() * 4)
            ],
            humidity: Math.floor(Math.random() * 100),
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

export const toolWeatherDefinition: ToolDefinition<WeatherArgs, WeatherToolResult> = {
    type: 'function' as const,
    function: {
        name: 'get_weather',
        description: 'Get current weather information for a location',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'The city or location name',
                },
            },
            required: ['location'],
        },
    },
    implementation: weatherToolImplementation
};

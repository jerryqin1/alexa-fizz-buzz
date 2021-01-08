const Alexa = require('ask-sdk');
const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');
const languageStrings = {
  'en': require('./languageStrings')
}
const AWS = require('aws-sdk');


/**
 * LaunchRequest - game launcher, initializes attributes/variables that maintain gamestate
 * @return - responsBuilder object that reads game rules for user and prompts user on whether
 *           they want to play or not 
 */
const LaunchRequest = {
  canHandle(handlerInput) {
    // launch requests as well as any new session, as games are not saved in progress, which makes
    // no one shots a reasonable idea except for help, and the welcome message provides some help.
    return Alexa.isNewSession(handlerInput.requestEnvelope) 
      || Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const { attributesManager } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const attributes = await attributesManager.getPersistentAttributes() || {};

    if (Object.keys(attributes).length === 0) {
      attributes.endedSessionCount = 0;
      attributes.gamesPlayed = 0;
      attributes.gameState = 'ENDED';
    }

    attributesManager.setSessionAttributes(attributes);

    const gamesPlayed = attributes.gamesPlayed.toString()
    const speechOutput = requestAttributes.t('LAUNCH_MESSAGE');
    const reprompt = requestAttributes.t('CONTINUE_MESSAGE');

    return handlerInput.responseBuilder
      .speak(speechOutput)
      .reprompt(reprompt)
      .getResponse();
  },
};


/**
 * ExitHandler - exits game and displays exit message
 * @return - responseBuilder object for alexa to read exit message
 */
const ExitHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
        || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    return handlerInput.responseBuilder
      .speak(requestAttributes.t('EXIT_MESSAGE'))
      .getResponse();
  },
};

/**
 * SessionEndRequest - handles user request to exit during game session and prints session
 *                     end reason
 * @return - responseBuilder obj to read user response
 */
const SessionEndedRequest = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);
    return handlerInput.responseBuilder.getResponse();
  },
};


/**
 * HelpIntent - handles HelpIntent request
 * @return - responseBuilder object to output help message and prompt user for response
 */
const HelpIntent = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' 
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    return handlerInput.responseBuilder
      .speak(requestAttributes.t('HELP_MESSAGE'))
      .reprompt(requestAttributes.t('HELP_REPROMPT'))
      .getResponse();
  },
};


/**
 * YesIntent - handles YesIntent request and starts instance of fizz buzz game
 * @return - responseBuilder object to begin the game and prompt user for next number
 */
const YesIntent = {
  canHandle(handlerInput) {
    // only start a new game if yes is said when not playing a game.
    let isCurrentlyPlaying = false;
    const { attributesManager } = handlerInput;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === 'STARTED') {
      isCurrentlyPlaying = true;
    }

    return isCurrentlyPlaying 
      && Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' 
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent';
  },
  handle(handlerInput) {
    const { attributesManager } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();

    sessionAttributes.gameState = 'STARTED';
    sessionAttributes.alexaNum = 1;
    sessionAttributes.nextUserNum = 2;


    return handlerInput.responseBuilder
      .speak(requestAttributes.t('YES_MESSAGE'))
      .reprompt(requestAttributes.t('HELP_REPROMPT'))
      .getResponse();
  },
};


/**
 * NoIntent - handles NoIntent request fom user and exits the game, this should not be used while
 *            game is in session
 * @return - responseBuilder object to exit game gracefully
 */
const NoIntent = {
  canHandle(handlerInput) {
    // only treat no as an exit when outside a game
    let isCurrentlyPlaying = false;
    const { attributesManager } = handlerInput;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === 'STARTED') {
      isCurrentlyPlaying = true;
    }

    return isCurrentlyPlaying 
      && Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' 
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent';
  },
  async handle(handlerInput) {
    const { attributesManager } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();

    sessionAttributes.endedSessionCount += 1;
    sessionAttributes.gameState = 'ENDED';
    attributesManager.setPersistentAttributes(sessionAttributes);

    await attributesManager.savePersistentAttributes();

    return handlerInput.responseBuilder
      .speak(requestAttributes.t('EXIT_MESSAGE'))
      .getResponse(); 

  },
};


/**
 * NoIntent - handles NoIntent request fom user and exits the game, this should not be used while
 *            game is in session
 * @return - responseBuilder object to exit game and ask user for restart directions
 */
const UnhandledIntent = {
  canHandle() {
    return true;
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    return handlerInput.responseBuilder
      .speak(requestAttributes.t('CONTINUE_MESSAGE'))
      .reprompt(requestAttributes.t('CONTINUE_MESSAGE'))
      .getResponse();
  },
};


/**
 * fizzbuzz - free function to determine correct response given a number
 * @return - approriate game response to a number (string or number)
 */
function fizzbuzz(num){
  if(num % 15 === 0) return "fizz buzz";
  if(num % 3 === 0) return "fizz";
  return num % 5 === 0 ? "buzz" : num;
}


/**
 * GuessIntent - alexa processes user fizzbuzz guess
 * @return - responseBuilder obj that advances the game, prompts user for new input, or ends game
 */
const GuessIntent = {
  canHandle(handlerInput) {
    // handle numbers only during a game
    let isCurrentlyPlaying = false;
    const { attributesManager } = handlerInput;
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState &&
      sessionAttributes.gameState === 'STARTED') {
      isCurrentlyPlaying = true;
    }

    return isCurrentlyPlaying 
      && Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' 
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GuessIntent';
  },
  async handle(handlerInput) {
    const { attributesManager } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();

    // initialize values for user's guess and true target response for 
    const target = fizzbuzz(sessionAttributes.nextUserNum);
    var userNum = parseInt(Alexa.getSlotValue(handlerInput.requestEnvelope, 'number'), 10);
    var userFizzBuzz = Alexa.getSlotValue(handlerInput.requestEnvelope, 'boolFizzBuzz');
    var isNum = (typeof target) === "number";

    if ((isNum && userNum === target) || (!isNum && userFizzBuzz === target)){
      let alexaNum = fizzbuzz(sessionAttributes.nextUserNum + 1);
      sessionAttributes.alexaNum = alexaNum.toString();
      sessionAttributes.nextUserNum += 2;
      return handlerInput.responseBuilder
      .speak(requestAttributes.t('NEXT_MESSAGE', alexaNum.toString()))
      .reprompt(requestAttributes.t('NEXT_REPROMPT_MESSAGE'))
      .getResponse();
    } else if ((isNum && userNum !== target) || (!isNum && userFizzBuzz !== target)) {
      sessionAttributes.gamestate = 'ENDED';
      attributesManager.setPersistentAttributes(sessionAttributes);
      await attributesManager.savePersistentAttributes();
      return handlerInput.responseBuilder
      .speak(requestAttributes.t('LOST_MESSAGE', target.toString()))
      .reprompt(requestAttributes.t('CONTINUE_MESSAGE'))
      .getResponse();
    }

    return handlerInput.responseBuilder
    .speak(requestAttributes.t('FALLBACK_MESSAGE_DURING_GAME'))
    .reprompt(requestAttributes.t('FALLBACK_REPROMPT_DURING_GAME'))
    .getResponse();
  },
};


/**
 * ErrorHandler - handles errors within the game 
 * @return - responseBuilder object to report the error message and get response from user
 */
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);
    console.log(`Error stack: ${error.stack}`);
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    return handlerInput.responseBuilder
      .speak(requestAttributes.t('ERROR_MESSAGE'))
      .reprompt(requestAttributes.t('ERROR_MESSAGE'))
      .getResponse();
  },
};


/**
 * FallBackHandler - handles miscellaneous intents and prompts the user for a response
 * @return - responseBuilder object to get use response
 */
const FallbackHandler = {
  canHandle(handlerInput) {
    // handle fallback intent, yes and no when playing a game
    // for yes and no, will only get here if and not caught by the normal intent handler
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent' 
      || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent'
      || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent');
  },
  handle(handlerInput) {
    const { attributesManager } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();

    if (sessionAttributes.gameState && sessionAttributes.gameState === 'STARTED') {
      // currently playing
      return handlerInput.responseBuilder
        .speak(requestAttributes.t('FALLBACK_MESSAGE_DURING_GAME'))
        .reprompt(requestAttributes.t('FALLBACK_REPROMPT_DURING_GAME'))
        .getResponse();
    }

    // not playing
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('FALLBACK_MESSAGE_OUTSIDE_GAME'))
      .reprompt(requestAttributes.t('CONTINUE_MESSAGE'))
      .getResponse();
  },
};



// the following code sets up and registers response interceptors, uses request interceptors in \
// order to request alexa user's locale and saves attributes to database, and 

const LocalizationInterceptor = {
  process(handlerInput) {
    const localizationClient = i18n.use(sprintf).init({
      lng: Alexa.getLocale(handlerInput.requestEnvelope),
      resources: languageStrings,
    });
    localizationClient.localize = function localize() {
      const args = arguments;
      const values = [];
      for (let i = 1; i < args.length; i += 1) {
        values.push(args[i]);
      }
      const value = i18n.t(args[0], {
        returnObjects: true,
        postProcess: 'sprintf',
        sprintf: values,
      });
      if (Array.isArray(value)) {
        return value[Math.floor(Math.random() * value.length)];
      }
      return value;
    };
    const attributes = handlerInput.attributesManager.getRequestAttributes();
    attributes.t = function translate(...args) {
      return localizationClient.localize(...args);
    };
  },
};



function getPersistenceAdapter() {
  // Determines persistence adapter to be used based on environment
  const dynamoDBAdapter = require('ask-sdk-dynamodb-persistence-adapter');
  return new dynamoDBAdapter.DynamoDbPersistenceAdapter({
    tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME,
    createTable: false,
    dynamoDBClient: new AWS.DynamoDB({apiVersion: 'latest', region: process.env.DYNAMODB_PERSISTENCE_REGION})
  });
}


const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .withPersistenceAdapter(getPersistenceAdapter())
  .addRequestHandlers(
    LaunchRequest,
    ExitHandler,
    SessionEndedRequest,
    HelpIntent,
    YesIntent,
    NoIntent,
    GuessIntent,
    FallbackHandler,
    UnhandledIntent,
  )
  .addRequestInterceptors(LocalizationInterceptor)
  .addErrorHandlers(ErrorHandler)
  .lambda();

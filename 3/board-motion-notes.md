# Board Motion

*Notes from an experiment that took far more rounds than I expected*

*Last updated: 19 November 2026*

I started from an old CodePen called [*SlowMo Mullen Card Trick*](https://codepen.io/luis-lessrain/pen/bNbmEqB). It was a card on purpose, and I liked it that way. I wasn't trying to fix it.

[Board Motion](https://es-d-00488249420261116-01a1d51e-bc08-7139-9ce0-a6ea97cf55c1.codepen.dev/) took a different direction. I wanted to experiment with a 3D skateboard, flatground tricks and slow motion. To rotate the camera, scrub through a kickflip, look underneath the board, inspect the wheels and trucks, and see what happened when I tried to make those movements behave physically.

It became much harder to convince myself that any of it looked real.

I used to skateboard. That changed how I judged the animation. I wasn't looking at the animation only as a developer inspecting a rendered object, or as someone comparing it with a video. I know, from having stood on a board, that a pop is not a neat rotation attached to an upward movement. You feel the pressure through your back foot, the release, the board coming up, the adjustment when it gets away from you, the catch and the landing. I cannot turn that memory into a set of exact force measurements. But I can tell when an animation misses the relationship between those events. It was not just my eyes saying that something was wrong. It was a remembered physical feeling that the simulation wasn't reaching.

I worked with Claude, first with Opus and later with Fable 5.2. This account is based on the versions, source files, tests and reports from that process, and on what I could see while using the result. I am not presenting a controlled comparison of models, or claiming that the final motion has been scientifically validated. I kept changing the work as it failed to convince me. That's the part worth documenting.

## The first version looked like an answer

The early interface had plenty going for it. A big 3D scene, trick navigation, playback speeds, a scrubber, and little descriptions of what each movement was supposed to be. It could show a skateboard with recognizable trucks, wheels, grip tape and a deck.

At a glance it looked as though the hard part had been solved.

Then I pressed Play.

The board snapped into its pop, spun on its axes, went through the floor in places and landed with almost no sense of weight. Some side profiles looked broken. The ollie was especially bad. It looked like someone had instructed a model to rotate and rise, which was, in effect, what had happened. Performance was poor too. What worked in a still image collapsed as soon as there was movement.

That became a recurring problem. Pop, flip, catch, land. We could name every stage without getting the movement between them right.

## The first repairs

We fixed the geometry. The deck profile, nose, tail, concave, trucks and wheels became more convincing. That was visible progress and I wanted to preserve it.

The animation was another matter.

The first motion system was deterministic: pick a time and calculate a position and rotation from authored curves. That's useful for a slow-motion experiment. It makes scrubbing reliable, because you can jump directly to any instant without having to simulate everything that came before it.

But the curves had no shared explanation. A pitch curve made the tail pop. Another curve moved the board upward. Others turned it around its length and vertical axes. A catch curve brought the rotations to an end. At landing the code moved into its grounded state.

The trajectories were tidy and the movement was awful. The board looked commanded rather than acted upon. Even the fix for floor penetration was initially a geometric correction: if part of the model went below the floor, lift the entire model back up. That stopped one class of visual error while introducing the possibility of another, a strange floating correction as the board rotated.

We tried to make the motion physically informed. Gravity-based arcs replaced some of the arbitrary vertical easing. Launch height, angular velocity and landing pitch acquired formulas. Then there were attempts to join the tail strike to the takeoff, soften the catch and add wheel contact and deck flex.

Each report sounded more convincing than the playback.

One landing was compressed into around eight milliseconds. That is less than a frame on a typical 60 Hz display. It could be numerically present and practically invisible. More calculation did not automatically make the result more readable, or more believable.

## Looking at an actual kickflip

We turned to reference footage. Claude inspected a Skateology kickflip filmed at a reported 1,000 frames per second, stepping through the pop, nose rise, flip, catch and landing. It reported a much quicker tail snap than our animation and a nose angle of roughly 50 degrees at one point. Those were observations from one clip, with angles estimated from frames, not laboratory measurements.

That changed the keyframes. The pop became quicker. The nose rose more sharply. The board levelled later, and the flip arrived at the catch in a different rhythm.

It helped, but only up to a point. A single kickflip reference cannot tell you how every varial, shuvit, hardflip or double flip should move. We had twelve tricks in the interface, and too many were still different combinations of the same mathematical rotations.

We also started noticing an odd kind of perfection. The board rotated around clean axes, arrived at an ideal orientation and stopped. A real skateboard can execute a clean trick, but the forces are never clean diagrams. The flick is off centre. A scoop affects more than one axis. The board can translate sideways as it turns. Catching it changes the rotation. Even a good landing has a history, because the way the board arrives matters.

I wasn't asking for random wobble. Adding noise to a perfect animation would only make a perfect animation noisy. I wanted the little deviations to have causes. Part of the irritation was that I could remember the instability in my feet better than I could explain it to an AI in equations. The board moves because you do something to it; then it responds, sometimes slightly differently from what you intended. A successful trick means working with that response. That is quite different from telling a solver where the board must arrive.

## Reading the physics instead of decorating the animation

We consulted *The Physics of Skateboarding* at Real World Physics Problems. Its explanation of the ollie was more useful than generic descriptions of kinetic and potential energy. It describes the sequence of forces: the rider's jump, pressure on the tail, impact with the ground, and the changing front-foot contact that helps guide and level the board.

The rider didn't have to be visible. Their influence still had to be there.

A skateboard doesn't make an ollie on its own. The rider jumps, presses, releases, drags, flicks, catches and absorbs impact. Those actions alter the board's motion. For a board-only experiment, you can model them as external inputs without building or drawing a human body. But it is still necessary to say when and where those inputs act.

We also read a broader article about energy and friction in halfpipes. Its principles are sound as general context, but it offered little practical guidance for a flatground kickflip. I didn't want every physics article, however authoritative its title sounded, to become a new reason to add machinery to the code.

I caught myself wondering whether the physics of skateboarding was uncertain in some deeper sense. That isn't quite right. Gravity, momentum, torque and friction do not become mysterious because someone is holding a skateboard under their feet. The uncertainty is in the model: the contacts are brief and complicated, a shoe can press or slide or lose contact, the deck flexes, and the rider reacts continuously. We were simplifying or inventing most of those inputs.

The research is revealing here. A 2021 mechanical-engineering study of the ollie recorded a real rider's foot movements and fed them into a multibody simulation. A 2024 study used a simplified human and rigid board to optimize ollie height, explicitly accounting for impacts and foot-board friction. Those studies do not suggest that an ollie is beyond physics. They show how much work is needed to model even one foundational trick with defensible inputs. We were trying to cover twelve tricks, in a browser, without simulating a visible rider. That doesn't make the attempt pointless. It puts its claims in perspective.

## The custom rigid body

Eventually the authored curves were replaced by a small simulation. The board became a rigid body with an estimated mass and inertia tensor. Gravity acts on it. The wheels, tail, nose and rails interact with the floor through contact forces. An invisible rider contributes weight, a jump, a tail stomp, a flick or scoop, and a catch. The legs are represented by springs and dampers during landing.

That was a real architectural change. It was not merely keyframes renamed as physics.

But there was a compromise at the centre of it. The simulation was still designed to land the chosen trick. A solver adjusted rider inputs until the board reached a desired catch orientation. That is a perfectly understandable engineering technique for making an interactive collection of successful tricks. It is not the same as starting from measured human movements and letting the board do whatever those forces produce.

Some solved inputs were so strong or precisely timed that they made the board look artificial again. The catch became a clamp. The landing became a common pattern. Several combinations could reach their target pose only if the virtual feet held or corrected the board more aggressively than real feet obviously could. Claude reported these compromises, which was useful. It did not make them invisible.

There were also spectacular misfires in the numbers. In one revision the board reportedly left the floor at nearly 8 metres per second and rose about 40 centimetres in 60 milliseconds. The front foot could not plausibly follow that motion. Correcting the model brought the board's takeoff closer to the rider's movement, but other tricks then failed to land. One fix exposed another assumption.

This is where the rounds became exhausting. A version could solve every trick numerically and still feel wrong under the mouse. I would report what I saw; Claude would modify the simulation; more cases would fail; another constraint would be added; the report would announce that all twelve landed again. The solver's ability to find a successful endpoint was becoming its own measure of success.

It wasn't mine.

## The landing, the flex and the sudden stop

The landing was the most persistent problem. Many tricks arrived looking different in the air and ended looking almost the same. In one version an 80-millisecond foot clamp, with strong holding forces, squared the board up before touchdown. That erased much of the incoming character of each trick.

Then the deck stayed visibly bent after the board had settled. The simulation included a resting deflection from rider weight, even though no rider was visible. On screen it looked like damage rather than load. The deformation was revised to show mainly additional impact load and recover afterward.

The board also appeared to stop dead after landing. At first that looked like an issue with friction or simulated momentum. Some of it was much simpler: playback ended while the board was still travelling, leaving it frozen at the final frame. Extending the rollout did not fully solve the impression. It still came to a visible end.

That ending was changed later. The board now keeps rolling while the picture fades out, and playback returns to the start. It no longer freezes in front of me.

And then we found the camera.

## The camera was lying about the motion

For a while the camera followed the board's movement so closely that horizontal speed barely registered. It also climbed with the jump, reducing the visible height change. A nearly featureless floor offered no landmarks. The skateboard might be moving in world coordinates, but it looked almost stationary relative to the picture.

Other corrections had made the rendering worse. An adaptive-resolution system lowered image quality when performance dropped and did not restore it afterward. The image could progressively turn soft. Fog began too close to the camera, making the board appear washed out or distant.

The camera was changed to a steadier travelling view. Concrete joints and subtle aggregate texture gave the floor a world-space reference. The fog was pushed away from the board. The resolution stopped declining with every slow period. Suddenly more of the motion made visual sense.

Before changing the motion again, I needed to check what the camera was actually showing.

There was another interaction problem: while the trick played, I couldn't freely drag to orbit the skateboard. I had to pause or finish the animation. That broke the point of an interactive slow-motion viewer. Later, orbit, zoom and touch gestures were separated from playback so I could inspect the board while it moved.

## Twelve tricks, and the trouble with perfect rotations

The trick selection settled on twelve: Kickflip, Heelflip, Pop Shuvit, Frontside Pop Shuvit, Varial Kickflip, Varial Heelflip, 360 Flip, Hardflip, Inward Heelflip, Double Kickflip, Double Heelflip and Impossible.

Originally the project also carried inventor credits, histories and sources. I became less interested in that part of the interface. Attribution has its own complications, and it was taking attention away from the movement. We removed the historical panel and kept short descriptions of the board's actions.

The physics kept pulling us back to the same question: why did the board still feel fake, even after it was genuinely simulated?

One answer was how forces were being applied. The initial flick and scoop inputs were largely clean torques about the board's own axes, effectively at its centre. They produced the correct kinds of rotation but very little of the sideways drift and coupling that real off-centre contact can create.

A later revision changed nine tricks to use forces applied at approximate foot-contact points. The simulation began generating lateral drift and small landing differences from those inputs. Claude reported pop shuvits drifting several centimetres and landing with a little tilt. The exact figures are outputs of this model, not measurements of real skaters. Still, the movement finally started looking less like a rotating object in a mathematics demonstration.

The shuvits needed one more round. Even with forces at the feet, the board turned almost flat, like a plate on a table, and the rotation was so perfect that it felt very fake. The scoop was moved earlier relative to the rotation, so the board was still pitched from the tail strike as it turned. It still begins after the wheels leave the floor, a limitation that matters later. Claude reported the tilt at somewhere between 16 and 35 degrees during the turn. Again, that is what this model produces, not a measurement.

It didn't solve everything. The 360 Flip and Hardflip still relied on cleaner torque inputs because the contact-force version could not reliably land them. The Impossible remained a simplified foot-guided rotation. Both feet still caught the board together after attempts at staggered contact destabilized several tricks. The catch retained some holding force. Those are real limitations of this version, not small print to erase.

A clean landing is not automatically suspicious. Real skaters can put all four wheels down close together. The question is whether that moment follows convincingly from the incoming motion, not whether every trick has a dramatic wobble.

## Performance, not just picture quality

The code accumulated a different problem along the way: solving each trick could take seconds. A very small time step, repeated runs and optimization meant some of the hardest combinations were expensive to prepare. Claude traced long solve times, tried addressing very small floating-point values, and eventually stored solved inputs so the browser could replay the resulting simulations without solving from scratch on every selection.

It also shortened the part requiring explicit simulation when the board was already rolling steadily, continuing that simpler movement analytically afterward.

According to Claude's browser measurements, preparation of all twelve tricks fell from many seconds to a few. I have not independently benchmarked that claim across devices. The important practical constraint is that a browser experiment should feel immediate. An accurate-looking frame is not much use if interacting with the page stalls the rest of it.

The source now carries a reproducibility obligation: if the physics constants, geometry or trick inputs change, stored solutions may no longer be valid. There are 32 of them now, twelve base runs and twenty height variations. The application checks each one before using it. A base run that no longer lands can be solved again in the browser. A variation that no longer lands is not solved again; the trick simply plays its base run instead. Keeping baked data in sync with the model is part of maintaining the project.

## The interface changed with the problem

At one point the UI tried to look like a laboratory exhibit. There were records, attribution states, historical notes and too much decorative framing. I eventually wanted something quieter: the board, the movement, the controls and concise trick names.

We stripped the layout down. We got rid of rounded pill buttons. Then we made the text too small. We corrected it and made parts of it too large. We adjusted it again. On a phone the trick selector originally demanded a long horizontal journey just to reach the later tricks. It eventually became a native dropdown.

None of these were major technical inventions. They were details that changed whether I wanted to use the thing.

The current title, *Board Motion*, is deliberately modest. I didn't want “Laboratory”, and I didn't want “Study”. This is not a scientific instrument, and naming it as one would suggest a certainty that the simulation hasn't earned.

## The playback speed was lying too

I thought the work was finished when I published it. Then I kept testing, and something still felt fake, and for once it wasn't the physics.

The default playback is a mode called Ramp. It doesn't run at one speed. In the first version it slowed the whole trick, pop and flight and landing, and came back to real time only at the end. Watching it, I realised that the landing never looked like gravity. A board that drifts down in slow motion and touches the floor gently has no weight, whatever the simulation says about it.

So the landing went back to real time, from the catch onward. That felt much better at once.

Then the pop. Slowed right down, it made the trick seem to happen in the same physical place as the pop, as if the board went up and did its rotation on the spot. The pop is now only slightly slowed, at about four tenths of real speed, and the deep slow motion, about a tenth, starts as the board leaves the floor. For a while the pop was sometimes skipped altogether, or went by too fast to see or feel. That turned out to be a playback fault rather than a motion fault: the speed was sampled once per screen frame, and the pop could fall between two samples. Playback now advances in much smaller steps.

One complaint stayed with me through several rounds: after the catch, the board seemed not to advance. It came down as if it were landing on the spot.

The first thing Claude found was real. The board rolled in at 1.77 metres per second and flew at 1.43. It was losing a fifth of its speed during the pop, because while the tail was being stomped the rolling resistance acted on the board alone, as if the rider's foot were sliding freely on top of it. Letting the stomping foot grip the board fixed that. Another assumption nobody had stated until it showed up on screen.

It still didn't convince me. Claude's next suspicion was the camera, which travels at about 60 percent of the board's speed on a desktop screen, so the board drops about 35 centimetres while moving only about 11 across the picture. The proposal was a wider shot and a slower camera. Before changing anything it asked me to do one thing: watch the same landing at 1×.

At 1× it looked fine.

So it wasn't the simulation, and it wasn't the camera. It was the way Ramp came out of slow motion. The catch happens almost at the top of the jump. Ramp held the board there, nearly still, and then jumped to real time within a few hundredths of a second. What I saw was a board hanging and then dropping all at once, and that reads as falling in place. The return to real time is now a steady speeding-up that begins at the catch, while the board is still high, so the forward travel picks up before the drop. The last 30 centimetres or so of the fall, and the touchdown, are at real speed.

Again I had nearly changed the motion to fix a problem in how it was presented. The camera mattered. So did the clock.

## Not the same trick twice

Two smaller things came out of the same testing.

Every replay of a trick was identical, down to the centimetre. That is what deterministic means, and I had asked for it. But watching the same jump reach exactly the same height again and again was its own kind of fake.

Each trick now has up to three versions: the normal jump, a slightly higher one and a slightly lower one. Replays cycle through them in a fixed order. Nothing is random, and the same replay always gives the same version, so the timeline and the scrubbing stay reproducible. Four tricks, the 360 Flip, Hardflip, Inward Heelflip and Impossible, have no lower version, because a lower jump didn't leave them enough time to land.

The landings change with the jump. I had asked whether some tricks could come down a little on the tail or the nose, as if they weren't perfect, because they felt too perfect. At that stage they did: the normal jump landed tail end first by about 5 degrees, the higher one landed flat, and the lower one landed nose end first by about 4 degrees. Those angles came from the rider leaning slightly differently at the catch, not from a rotation added afterward. They are this model's outputs, as before.

It is a small thing. It also changed how the whole page feels, because I stopped being able to predict the next replay exactly.

## The trucks were rigid, and so was the rider

One more thing kept bothering me, and it came from my feet again. Trucks are not rigid. The hanger turns on its pivot, the bushings resist and bring it back, and you feel that every time you load the board, land or roll away. Ours were a solid lump bolted to the deck.

I asked Claude to investigate before changing anything. The first answer was that there was nothing to see. It measured how far the deck leaned sideways while the wheels were on the floor: at most 1.7 degrees, for 16 milliseconds. The recommendation was to leave the trucks alone.

I asked one question back. The wheels are rigidly fixed to the board and resist exactly that lean. Could the model be suppressing the thing we were trying to measure?

It could. Claude had measured the response, not the load. Measured the other way round, the wheels turned out to be carrying tipping torques of 180 to 300 newton metres at landing on five of the twelve tricks, forcing the deck level against the rider's feet. Before takeoff the tipping load was exactly zero.

That still didn't say how far a deck on bushings would lean. Feeding those torques into a soft truck gave 10 to 39 degrees, which is nonsense, and Claude said why: the torques were the rigid wheels' own reaction to not being able to lean. Take the rigidity away and most of the torque never arises. So Claude ran a proper experiment on a scratch copy, with one articulation angle per truck and the wheel contacts moving with it.

The kickflip didn't change. The pop shuvit tipped over until the bushings bottomed out at 11 degrees.

Claude recommended leaving the trucks rigid for good. The lean, it said, followed where the rider's feet stood, not the trucks. I read the same result differently. The rigid trucks had been hiding a rider who had no sideways behaviour at all. That was the thing to fix.

It came apart one trace at a time, and every time the cause was something the invisible rider did that no real one does:

- The rider’s feet were fixed in space sideways. The board went on drifting under them, by up to 15 centimetres.
- The rider’s whole mass was locked rigidly to their feet. A landing a few degrees crooked shoved the deck sideways with nearly a thousand newtons in two hundredths of a second.
- The four foot contacts stayed square to the direction of travel, not to the board. On a crooked landing two of them sat on the deck's edge and kept dropping off and back on, which showed up as a kick every 0.3 seconds.
- A foot more than a centimetre past the rail counted as off the deck altogether, so the whole load jumped to the other side.
- The rider’s weight came down at the middle of their feet, not under their own mass, so when they swayed after a landing the deck never felt it.

We changed those assumptions one by one. The rider now has their own sideways position and speed and leaves the ground moving with the board. Their legs give sideways. From touchdown their feet stand on the deck and turn with it, and a foot that overhangs the rail still presses at the edge. Their weight comes down under their own mass. After a reaction time they slowly shift pressure against a lean that lasts, by two centimetres at most.

Two faults were in the takeover itself. The give in the legs, switched on at the catch, broke the hardflip's catch in the air, so it now starts at first wheel contact. And the trucks were taking over one simulation step after that contact, so the deck took the first impact as if rigid: a kick of 230 degrees per second that nobody had asked for.

What it does now, in this model: the kickflip leans 0.4 degrees, the pop shuvit about 4 degrees for 0.18 seconds, the varials up to 6.6. None reaches the bushing stop. All 32 runs land. Two needed a new foot burst: the normal inward heelflip and the higher 360 flip.

The hanger, axle and wheels are now drawn as a part of their own, turning about the same pivot line the simulation uses, and the bushings shear with them. Claude checked that in close-up stills: at the peak of a varial heelflip landing the axle sits flat on the floor while the deck leans, and forcing the hanger rigid in the same frame pushes one wheel into the ground.

There are honest limits here. The pivot is the line the truck happens to be drawn with, about 14.5 degrees from the deck, so it steers roughly a quarter as much per degree of lean as a real truck. Every stiffness and damping value is an estimate. The peak wheel forces are spikes from the contact damper and shouldn't be read as real forces. And nothing happens before takeoff. The rider's load is symmetric, the wheels leave the floor at the tail strike, and the flick or scoop starts a few hundredths of a second later. A real scoop begins while the tail is still being pressed down, so a real rear truck would feel it. Changing that would have meant re-solving seven tricks and the pop I had asked to keep, so it stays as a known gap.

## The deck bent too much

The same change made the landing look rubbery on some tricks, and I could see it before I had numbers for it. The pop shuvit's deck was dipping a third more than before.

The higher peak came from a different foot-contact pattern, not from a newly invented force. With the feet square on the deck all four contacts carry the landing, so the load arrives in about four milliseconds, and the drawn deck was following any load within six. It snapped down at close to a metre per second. The fix was to the deck's response, not to the forces: the drawn bend now follows the load through a response time of 20 milliseconds, an estimate for a deck with feet standing on it. The pop shuvit went from 5.5 millimetres back to about 4.3, close to the original 4.1. Claude measured roughly half the previous peak bending speed.

At that stage it was still a visual approximation, not a structural calculation. It ignored where the feet stood, and they landed over the truck bolts, where a real deck bends less than this. I would come back to that assumption.

## The bolts had to go somewhere

I thought I was done with the trucks, then noticed something else. Even after the hangers and bushings began moving properly, the whole assembly sometimes looked detached from the deck when it flexed. I went back to the anatomy of an actual skateboard. Each baseplate is attached to the wood with four bolts. Those bolts do not give the truck permission to float against the underside of the board.

The cause was in the drawing. The shader bent the wood, grip and underside, while the baseplate and its bolts stayed with the undeformed board. The curve happened to pass through zero at the centre of each mount, so the middle looked attached. The edges did not. Claude measured about one to two millimetres of difference across the bolt positions and baseplate edges during a hard landing. Enough to disturb the relationship I was looking at.

We first held the deck still across the mounting footprint. That fixed the connection and made the bend too steep immediately outside it, around ten degrees against roughly three and a half before. A second profile eased the deformation into and out of the constrained regions. The four bolts on each truck now remain seated relative to a flat patch of wood. The deck bends between and beyond those patches. It is an approximation of a bolted joint, but at least the parts belong to the same object.

That was only the beginning of another argument. I asked whether the shape of the bend was right in the first place. What if someone lands with a foot nearer the nose, or one foot takes most of the load? The simulation already had forces for four sole contacts and knew where they pressed along the deck, but discarded that detail when calculating the displayed flex. One overall load drove one fixed curve.

Claude initially advised against changing it. The invisible rider landed with both feet close to the truck bolts on every solved trick. A basic beam calculation predicted far less central bending than we were drawing. I wasn't convinced that the rider's fixed stance was a law of nature. Claude tested moving the feet in a scratch copy. The fixed positions weren't necessary: all thirty-two runs still landed when the feet stayed under the rider. I didn't pursue changing the stance. The model even had a little variation in where the rider was relative to the board at catch, then deliberately centred the feet again.

Claude used the individual contact forces and positions to calculate the central bend against an estimated stiffness for a maple deck. The landing dip fell from roughly four to seven millimetres to around 0.6 to 1 millimetre. It was a more defensible calculation, with major qualifications: estimated wood properties, a flat beam instead of a concave laminated deck, simplified truck supports, and impact forces strongly affected by our invented leg damping. None of it was a measurement of a real skateboard.

Claude checked whether an asymmetrical bending curve would improve things. Some tricks did load one foot more, but both feet remained so close to their respective mounts that the asymmetric curve differed from the symmetric one by at most about thirteen micrometres in Claude's scratch runs. Hardly a reason to add a new recorded channel and shader parameter. A more exact-looking formula would not necessarily make this experiment more honest.

And then I couldn't see the deck bending at all. The calculation had become too small to read at ordinary viewing size. After more discussion, that version kept the position-aware load calculation but drew the resulting deformation at five times its calculated size, roughly three to five millimetres on the landing examples Claude checked. That factor was explicitly a visual scale, not a new claim about wood stiffness. The mounting areas stay fixed. Double flips and Impossible tend to show more of the drawn bend; the Pop Shuvits show less. That difference helped explain why I could see it on some tricks but almost not at all on others. I was still not convinced by the flex. That is where I left it on 15 November 2026.

## Somewhere to look from

After all that, the detail was there and hard to find. You had to know which trick, which speed and which angle.

At that stage there were four views: Truck response, Deck flex, Flip mechanics, Rotation and catch. Each one only sets up what already exists: a trick, one of its stored jump heights, a speed, a place on the timeline and a camera position. The values come from the runs. Truck response uses the lower varial heelflip because it leans the deck most, and Deck flex initially used the higher Double Kickflip, one of the harder landings. That view would change when the variations began producing visible bending of their own. One view moves the camera during the slow flight, and any touch on the view ends that at once. The camera can also now aim at the board on the floor and keep it centred, which it couldn't before: zoomed in, a landed board used to sit at the bottom edge of the picture.

The views took a few rounds of their own, and most of that was working out what a view is. A view stays when I pick another trick, so I can walk through the landings from the same angle. If I drag or zoom, I have left it: the highlight goes and the camera stays where I put it. The two landing views start just before touchdown, not at the roll-in. That confused me at first, because picking another trick seemed to change nothing; the new trick was simply appearing at the same moment of its own landing. Now the picture fades in when a view starts a trick, and a line under the description says what the view shows and where it begins.

The articulated trucks became the default.

Strobe stays still. I asked whether it should move like the rest, and the answer was no: it is a strobe photograph, and the point is comparing the frozen exposures.

There were also interface fixes I had put off. On a phone the speed buttons and the tools were sitting on top of each other; they have their own rows now. Hovering a selected button turned its text the same colour as its background. Bold was too bold, and on Windows there was nothing between regular and bold until the system's semibold was borrowed for it. Text no longer gets selected by accident while dragging the board. The deck graphic went from a 1.5 megabyte PNG to a roughly 35 kilobyte WebP. The artwork has a longer history. Back in 2017, we worked on *Deckheads* at Less Rain, a skateboard customization project where people could make and remix their own deck designs. One of its campaigns was *Making Decks Great Again*, with a series of ridiculous Trump graphics. The site no longer exists, but I still had the artwork. I adapted one of those designs for Board Motion: the face is blank, and the speech bubble now says, “NOBODY! SKATES BETTER THAN ME!” Almost ten years later, that old graphic is back on a skateboard.

## The board came down like a box

I thought the landing was good once the wheels touched. The new truck response had weight, and the flex, whatever its exact size, moved with the impact. But between the catch and the floor the board still sometimes came down like a box. At one tenth or a quarter speed I could follow the movement and it looked convincing. At real time, especially in Ramp, it lost that feeling.

My first suspicion was playback. Claude checked it at the simulation's one-millisecond resolution, then at sixty frames per second. The interpolation was correct. Ramp showed the same trajectory, only with a different clock. The problem was that several important events fitted inside a single screen frame: on a kickflip the catch killed most of the spin in about nine milliseconds; the first-to-last wheel contact often took less than eleven; the first landing compression reached its low point in roughly ten to thirteen. At 1× I saw the board become square, descend in several nearly identical steps, and stop.

Claude found that the board's descent after catch was heavily governed by the invisible rider's legs. At first it blamed the smooth leg-extension schedule. Experiments made no difference because another rule was overriding it: whenever the soles carried very little load, the legs kept reaching for the board. In the air that condition was nearly always true. The simulated springs could end up internally compressed while their damper cancelled much of the force. On Impossible, the last part of the descent became almost constant-speed, just as it looked.

Claude tried different extension controls in scratch, leaving the working project alone. A steady extension let gravity show through more clearly and all thirty-two solved runs still landed. Then Claude found that the legs were continuing to extend after the first wheels touched, inflating the impact forces. Stopping them at contact corrected that extra push, but shifted truck lean, reduced the already small flex, and left the rider at a different final height. Claude made side-by-side playback recordings. Impossible and Pop Shuvit changed somewhat; on Kickflip, 360 Flip and Hardflip the improvement was barely visible at real speed. I preferred what we already had after landing. I rejected that branch.

Another explanation remained. Every trick was solved toward almost the same completed, level catch. Most of the board's residual rotation disappeared quickly under four virtual sole contacts. Some of those contacts could pull the board upward, though a shoe cannot physically do that, and could retain grip with very little pressure. Weakening those shortcuts broke the spin tricks. But the stored trajectories had been solved around those shortcuts, so a failure did not prove the alternatives were impossible.

Claude also tested catching later. It moved the catch time and re-solved a few tricks. Kickflip and Impossible had room to catch later; Hardflip and 360 Flip were much more fragile. A later catch left less time for that perfectly level descent, but it changed the burst, increased some touchdown speeds and made the landing tilt flatter. More importantly, it still aimed for the same ideal catch. The box had less distance to fall. It was still a box.

I suggested letting the board arrive slightly wrong and giving the rider time to correct it. The solver already accepted a rougher catch than the one it usually tried to produce, but small errors disappeared quickly under the existing contact forces. On a kickflip, a deliberately weak flick could be fifteen to thirty degrees short and still arrive at the floor almost exactly like the original. On a pop shuvit some heading error survived. The 360 Flip was intolerant of small changes.

Claude tried an evolving foot plane, starting from the board's actual tilt at catch and returning toward the landing posture through the existing contact forces. It made an imperfect kickflip recover more gradually. On the stored clean kickflip, which already arrived almost level, there was nothing to recover. Spin tricks lost the immediate resistance they needed: some failed, others landed badly tilted, and truck response shifted. Another promising mechanism had improved the demonstration case and damaged the cases that most needed it.

Those rounds taught me something about how we'd been judging the project. Thirty-two clean landings were treated as proof that a modification worked; fewer than thirty-two were treated as proof that it didn't. But every one of those clean runs had been optimized to arrive at a particular catch. We were measuring how well changes preserved a decision made earlier. I was interested in what happened when that decision was less exact.

## Let it miss

I kept coming back to the same idea. I didn't want a random wobble placed on top of a good trick. I wanted a trick to be attempted slightly differently, so the difference would run through the whole movement. A real attempt can be caught slightly short, slightly past, or not caught at all. A landing can be awkward and still work. Failure belongs to skateboarding too.

Claude built a temporary comparison with the existing kickflip and four small changes: a flick four percent weaker, a flick three percent stronger, the feet arriving twenty milliseconds early, and the feet ten milliseconds late. Nothing was re-solved after changing those inputs. The same simulation decided the result. Three altered attempts landed, and the late-foot one failed. I liked all five. Even the failure had a quality the perfect repetitions lacked. For the first time I wasn't asking Claude to prove a new contact rule with another table. I could see the consequence of a different attempt.

That led to Attempts, later called Variations in the interface. It sits alongside Clean run in the playback bar. Clean run keeps the thirty-two stored successful solutions and the existing cycle of jump heights. Variations takes the next solved run, alters the physical inputs by a small, reproducible amount, and simulates the result once. At first, flick and scoop strengths could change by up to four percent; foot return timing by twelve milliseconds. Impossible varied its hooked push by up to twelve percent instead. These are chosen input ranges, not measured statistics about how skaters perform.

There is no promise that the board lands. A variation may roll away, touch down crooked or tumble. A failed run is allowed to stay failed. The description names the changed inputs and whether the attempt landed, while a failed run is labelled “Did not land” on the timeline. We had to make one small change to the model for that: if the board tips too far away from the feet, or the rider comes down well without it, the rider loses the board and cannot somehow catch it again with an absurd force. The board then carries on by itself. With no rider visible, that is an incomplete account of a bail, but it is better than snapping a lost board upright.

Nothing random is added to the picture. The input differences come from the trick and the attempt number, so a given attempt can be replayed and scrubbed exactly. Pressing for another run in Variations mode advances to a new set of inputs. A dozen tries of one trick will not necessarily include a failure; another trick can miss several times. Claude sampled the first twelve attempts across the tricks and found very different success counts. We didn't tune them all to the same rate.

I like this more than I expected. The original clean tricks are still there, and now I can watch the same trick respond a little differently. The mechanics haven't become more scientifically complete. The simple contact model still decides what is recoverable, and the initial variation ranges were shared across tricks, apart from the Impossible's push, rather than fitted separately to each trick. But the movement is less predetermined, because the solver no longer guarantees the endpoint for every run.

## More movement, fewer controls in the way

Adding Attempts made the interface crowded again. We first put New attempt and Original trick below Views, which confused two different things: where I look from, and whether I'm watching a solved trick or another attempt. After another round the choice became a two-button switch, Clean run and Variations, next to the playback speeds. It changes what the next run will be, without replacing the run I'm pausing or scrubbing. The N key switches modes. At that point, all four views used Clean run, so an inspection preset did not accidentally start a failed attempt. Choosing Variations afterward keeps that view’s camera position, even though the next run is no longer the solved one.

The list of tricks now sits under the title. Views stay at the lower right. On desktop the two lists can slide off their respective edges, leaving just the headings and a little more room to look at the board. On phones they remain ordinary menus. The playback controls wrap when there isn't space for everything on one line. Changing modes briefly explains what will happen, rather than switching the trick in the middle of a movement.

I asked for the interface to get quieter again, even though the experiment was doing more. I had also spent too long calling the invisible rider “he” in my notes. Nothing about a rider's force, stance or catch requires that assumption. The person on the board can be anyone, even if the person isn't drawn.

## Where the feet land (16 November 2026)

On 16 November 2026, I was looking at the flex again. The five-times scale made it easy to see, but the deck looked too much like rubber, especially from behind. Claude traced several landings frame by frame. The bend rose once and recovered; it was not oscillating. The trouble was partly the shape: for a drawn five-millimetre dip in the middle, the nose and tail had been moving by roughly six millimetres. The ends were flapping more than the span was bending. Claude reduced that exaggerated end movement, but I still did not like the overall result.

I brought in two articles about deck construction. Both describe the conventional seven-ply maple deck, its laminated structure and the differences made by glue and reinforcement. Neither provides a measured stiffness or impact response for our particular board. One practical point mattered more than the material catalogue: landing over the trucks protects the deck. Claude checked the code. Every clean run puts the two feet about 200 millimetres either side of the middle, only eight millimetres inside the truck mounts. At the catch, their longitudinal position is brought back under the rider. We had built a near-identical, near-bolt landing into every solved trick, then enlarged the tiny bend it produced.

That gave me another reason to use Variations. The feet no longer have to land at exactly those two positions. Each can come down up to 80 millimetres farther inward, independently of the other. Most attempts stay close to the bolts; the larger offsets are less common. Those are changes to the contact positions used by the simulation, so the foot loads, balance and calculated flex change together. I did not ask for a prewritten bad landing or a bend added after the simulation. Moving away from the bolts does not automatically mean a failed trick.

The five-times drawing scale is now gone. Clean runs still put the feet over the mounts and show only about 0.6 to 1 millimetre of calculated bending, almost invisible at ordinary size. Some off-bolt variations bend by roughly three to nine millimetres without enlarging the drawing. The nose and tail follow the bend in proportion again. The deck still uses a simple beam approximation and a twenty-millisecond response. The visible result is finally closer to what I wanted: the impact is different because the landing is different.

We also widened the other input changes: flick by up to six percent, scoop by five, foot timing by sixteen milliseconds, and the Impossible's hooked push by sixteen percent. At that point a variation reported one of three outcomes: it lands, it lands badly with visible bending, or it does not land. The phrase “lands badly” uses a three-millimetre flex threshold, not a measured limit for a damaged deck. An upright board that rolls away without its rider no longer counts as landed. In Claude's sample of the first sixteen variations of each trick, roughly thirty percent landed cleanly, thirty-one percent landed badly and thirty-nine percent failed. We did not target those proportions.

At that point Deck flex became the exception among the four views. It opens on a Double Kickflip variation, selecting the successful attempt with the largest calculated bend among the first twenty for that trick. The other views still use clean runs. The description at the top right can also slide away like the Tricks and Views lists; on intermediate desktop widths it starts collapsed instead of disappearing altogether.

There are limits I want to leave visible. Eighty millimetres inward is a chosen range, not a measurement of actual catches, and the model never puts the feet farther out toward the nose or tail. The three-millimetre line separating clean from rough is a description choice. The bending remains a visual response to simulated forces, not a flexible-body calculation that feeds back into the board's rigid-body motion. I am happier watching it now. That matters to this experiment, but it is not proof that the flex is physically exact.

## When the deck breaks (16 November 2026)

I was finally happy with the flex, so naturally I asked another question. If landing away from the bolts could bend the deck properly, could a sufficiently bad landing break it? I wanted that to come from the same forces, rather than choosing an attempt and telling the board to snap. Broken decks do happen in skateboarding, though a flatground trick normally isn't the kind of impact that destroys one.

Claude treated the deck as the same simplified beam we were already using for flex, and added an estimated strength for maple. At roughly 100 megapascals, the calculation puts failure at about 27 millimetres of central deflection, with a range of about 22 to 33 millimetres if the assumed strength changes. Those are model estimates, not measurements of this skateboard. The first set of figures Claude reported was wrong: it had tested with the articulated trucks switched off. Claude corrected the setup before we accepted the numbers. With both feet together at the middle, the usual leg stiffness bent the deck by around 17 to 21 millimetres without breaking it. Stiffer legs could push it past the estimated threshold; at twice the stiffness, the Double Kickflip, Double Heelflip and Impossible broke in the test. No ordinary clean run or existing off-bolt variation was close to doing that.

Once the threshold was crossed, the harder problem was showing what followed. Claude tried letting the middle fall under gravity, but it looked as though the board had landed and then decided to fold. A bounce of the broken ends gave it a second impact that I didn't believe either. The current version carries the force that broke the deck into the collapse. The middle reaches the ground in about ten milliseconds and drags rather than bouncing. That timing and the post-break friction are simplified assumptions. They made the sequence read as one incident on screen.

The graphic has its own compromises. The deck folds into a V, with the grip tape still joining the halves. The trucks turn with those halves, the shadow folds, and the seven plies split at different places along a ragged line. I like the result, but those splinters are drawn by the shader. The simulation decides whether the bending threshold is crossed; it does not calculate where each layer fractures or how wood fibres tear. The rider is also assumed to stay on the broken board, and some wheel-contact calculations still behave as though the rigid deck were intact. We kept those limits visible rather than claiming to have simulated wood fracture in full.

There is now a fifth view, Broken deck. It starts from the beginning of a Double Kickflip at real speed, putting both feet together at the middle and increasing leg stiffness until the simulated run breaks. I can watch the entire trick, then replay the same event at a quarter or a tenth of normal speed. A break also gets a marker on the timeline and its own outcome, “The deck breaks.”

Broken landings can happen in ordinary Variations too, though not often. In about a quarter of generated attempts the feet arrive together near the middle; in half of those the simulated legs are also stiffer. The rest use the previous variation model. In Claude's first sixty attempts of each trick, roughly a quarter landed cleanly, thirty-five percent landed badly, thirty-eight percent missed and two percent broke. Those percentages describe a sample of this model, not the frequency of broken decks in real skateboarding. I didn't set a target failure rate. The new possibilities came from changing inputs, and the existing Deck flex view deliberately skips the feet-together attempts so that it still demonstrates a bending deck that survives.

One last interface argument followed. Views had started behaving like settings that weren't properly undone. A view could change the playback speed or mode and leave them changed after I left it. Now a view owns its run, camera, starting moment and a small choice of speeds. While I'm in it, the other speeds, Variations switch and Strobe are unavailable. I can still pause, scrub, replay, move the camera or choose another trick without losing the view. Reset view or Reset leaves it and restores the speed and mode I was using before. Opening a view waits for Play rather than starting on its own. It took another round, but the controls finally describe what the page is actually doing.

## Back to the landing (16 November 2026)

The same day I went back to three things that still bothered me. The board felt too light when it came down. The deck sometimes wobbled. And I wondered whether a deck could also break the other way, into an inverted V. I asked Claude to measure before changing anything.

Gravity turned out to be innocent. It is 9.81 metres per second squared, on a 2.5 kilogram board under a 70 kilogram rider, and from the top of its flight until the feet come back the board falls at exactly that rate. The Impossible is the one exception, because its hooked foot is still carrying the board round. Claude then told me that after the catch it came down at a constant speed, like a lift. That was wrong. It checked the fall against a free fall from the same height, the two matched to the centimetre, and it withdrew the claim. What the audit did show is that the feet can hold the board up by 150 newtons per contact, which real feet cannot do, and that most clean runs use that hold at its limit. The board touches down at about 84 percent of free-fall speed on average, anywhere from 62 to 103 percent depending on the run.

I asked to look at the Pop Shuvit, where the landing bothered me most. Stepped frame by frame it was plain: the board spins at about 1100 degrees per second, finishes its half turn 28 centimetres above the floor, is stopped by the feet within two hundredths of a second, and then falls for 0.14 seconds with nothing left to do. The trick was faster than the landing. Claude tried a later catch with a grip that builds gradually. The landing improved, and the idle fall got about a third shorter, but the early catch was the stylish part and the later one looked plain to me. A still later catch only solved by falling back to plain torques, at two of the three jump heights and not one as Claude first reported. None of that was merged.

The box itself took longer to pin down. Claude measured how long each board is completely motionless between the catch and the floor. In most runs it is a few thousandths of a second. In five of them, the higher jump of the Kickflip, the Heelflip, both Pop Shuvits and the Impossible, it was 45 to 65 milliseconds. Those were the runs with no landing tilt at all: the normal jump comes down back wheels first, the lower one front wheels first, and the higher one had been left flat. The feet square the board up completely within a tenth of a second of the catch, so a flat run then had nothing to do but wait. That also explained something about Variations. They either landed exactly like the clean run or went badly wrong, with almost nothing in between.

What helped was a tilt the rider holds on purpose, to one side as well as along the travel. On the Pop Shuvit, about five degrees of sideways lean made the landing look much better to me, and I wanted to know why before trusting it. Claude put probes on each wheel, both trucks and the bushings. When the first wheel touches, its hanger swings almost five degrees within six milliseconds while the deck stays leaned, and no bushing reaches its stop even at eight and a half degrees. Most of what I liked was already there: the flat landing also leans the deck about four degrees to one side a moment after touchdown and settles within two tenths of a second. The lean changes how the board arrives, not how it settles. The wheel forces needed a correction too. Claude's first table compared single wheels and made the flat landing look gentlest. Per truck it is the hardest, about 6000 newtons against about 4100, because two wheels take the blow in the same instant. The peaks last under a thousandth of a second, and the impulse they carry goes down as the lean goes up.

I did not want five degrees to become another universal correction, so each of the 32 clean runs now has its own small lean, between nothing and 3.4 degrees. Its direction is the way that run's deck already leans after landing in the simulation. Its size was chosen by hand. Five runs stay level. That last part is a rider input, not something the physics produces, and I want that written down.

The Impossible showed a second problem. At a quarter speed it seemed to correct itself in two steps after the catch. It did: the board arrived ten degrees nose down, the feet snapped it level in three hundredths of a second, and only then did the landing tilt creep in the other way. Claude first applied the tilt at the catch itself. Every run still landed, but the Hardflip and both lower Pop Shuvits came down rolled by 15 to 33 degrees with a truck on its bushing stop. A quicker tilt fixed the Impossible and made the Inward Heelflip worse, freezing it early. What stayed is the simplest version: both tilts build steadily from the catch until the wheels touch. The longest motionless stretch before a landing went from 65 milliseconds to 11. The normal jump now touches down at about three and a half degrees instead of five, still easing into it.

The floating at a quarter speed is another matter, and it is not fixed. Slow motion weakens gravity on screen by the square of the slowdown. At a quarter speed the board falls as if gravity were about 0.6 metres per second squared, less than half of the Moon's. In real footage the body tells you it is heavy anyway. Here there is no body, the trick finishes early, the Impossible is caught 44 centimetres up, and the fall that follows takes half a second on screen with nothing to watch. Ramp feels better because it returns to real speed for the fall and the landing.

Then the wobble. I kept seeing the deck move like a wave in Variations. Claude told me it was three landings in a hundred. It had counted only the ones that bent twice. Counting every landing that bowed more than ten millimetres it was 72 of 720, one in ten. A quarter of all variations brought both feet together toward the middle, most of them with ordinary legs, and the deck bowed 10 to 23 millimetres and sprang back. Twice Claude argued for leaving it, because the model had calculated it. I also thought I saw the deck bending diagonally, which a maple board should not do. It was not a diagonal bend. The bend is drawn along the length only, and what I saw was that bend together with the deck leaning eleven degrees on its trucks. A real deck does twist a little; this one doesn't at all.

Even the landings that broke still waved first, and that turned out to be a real error. On one Inward Heelflip the deck dipped two millimetres while only one truck was on the floor, relaxed, and then bent for real when the other truck came down. A board cannot bend against a single support. With one truck in the air it simply turns about the other. The bend had been sized from the feet's load alone. It is now limited by what the less loaded truck pushes back, so it stays at zero until both are down, and no landing bends twice any more.

The last bow before a break was also too much. The deck only snapped at 27 millimetres of bend, and by then the middle was down and both ends were curling up, about five centimetres of visible curve. It now breaks at 16 millimetres. I should be clear about that number. Claude's 27 came from the strength of clear maple. A deck is drilled for eight bolts and glued from plies, so it should let go earlier, but how much earlier nobody here has measured. Sixteen was chosen because the bow looked exaggerated to me, and it sits below the range Claude had written down for maple. The feet now come down together only as that hard landing, right at the middle and always with stiff legs. Claude first made it one variation in forty, to keep breaks at two percent, and then I never saw a deck break: on most tricks not before the twenty-fifth attempt, on three of them not once in sixty. It is now about one in twenty. In the first sixty attempts of each trick, about 31 percent land cleanly, 30 percent land badly, 35 percent miss and four percent break, and every trick breaks at least once. No surviving landing bends more than ten millimetres. The Broken deck view now breaks with ordinary leg stiffness, on every trick.

One more thing showed up once the break looked right. The broken board stopped as if it had hit a wall. The floor drag had been applied to the board alone, two and a half kilograms, while the rider standing on it kept going. The board lost a fifth of its speed in five thousandths of a second and slid back under the feet. Shoes grip a deck harder than splintered wood grips the floor, so rider and board are now slowed together. It still comes to rest within about twenty centimetres. It is only rolling at walking pace, with the whole landing pressing broken wood into the ground.

Two ideas were looked at and left. Drawing the nose and tail rising less while the deck bends would have softened the wave, but the rise matches what the model's own beam predicts for a board resting on two axles, and I had no measurement to argue otherwise. The inverted V was not built. Loads outside both trucks would stress the deck most at the truck mounts, so a tail or nose snapping off there is the more likely failure, and that is a different break and a different drawing.

Through all of it the 32 clean runs still land, and each flight is unchanged up to the catch. I was lost more than once that afternoon. Several times I could not say what was wrong, only that something was, and several times the first measurement said nothing was. The lightness has an explanation I can live with. The box, the wave, the bend on one truck and the board hitting a wall were all there to be found.

## What Ramp was really showing (17 November 2026)

I started with a small thing. The Broken deck view opened at real speed and I wanted it slower. A tenth was too much: about ten seconds of waiting before anything broke. A quarter is where it stayed until later, when I set that view to open in Custom with the two marks where I liked them. It shows the break well, and it shows what Custom is for. I also asked why Ramp was not allowed in that view, since it plays the whole trick. Claude reminded me that I had asked for real speed there when the view was first built. There was no other reason, so Ramp came back.

It came back broken. In that view Ramp was slow from the pop until well after the break. A run that breaks had a second slow-down of its own for the break, and it began exactly where the return to real speed ended. Claude moved it to just before the break. That looked better and I said so. It was not the end of it.

Watching the break I also saw the board go into the floor. Spin tricks break while the deck is leaning about twelve degrees on its trucks. The broken middle dropped as far as it would on a level board, so its lower edge went 20 to 25 millimetres under the floor on those tricks, and up to 13 on the flips. The drop is now measured to the lower edge.

Then some things in the interface. The trick's name was the same size as the title. It now sits between the title and the list, which is only half a pixel either way but reads right. The description was too heavy and dense, so it is a size smaller with more room between the lines. The name and its arrow sat level with the title; they are now level with the Tricks heading. The arrows had a faint outline, most visible in Firefox, because each was a small picture used as a mask. They are two plain lines now. Then I saw that the arrow sat slightly high. It had been centred on the line, and the eye reads the middle of the small letters, which is lower.

I wanted to play with where Ramp's slow motion starts and ends, so I asked for something to drag. Claude put two marks on the timeline in a scratch copy. I liked them enough to keep them as a new speed beside Ramp. We called it Custom. It is not offered on phones, where a timeline that narrow is no place for dragging, and it is allowed in the views that play a whole trick and already allow Ramp. The marks were first labelled “slow” and “real”. I asked for the speeds instead, ⅒× and 1×. Ramp's slow motion is 0.09, a little under a tenth, so Custom's was set to exactly a tenth to make its label true. The labels then took three rounds: too small to read, then the seconds too large, then the seconds sitting off the line because they were in a different typeface from the speed. The marks were also too tall and ran into the line of text under the timeline.

In between I asked whether the break could move more, the way a missed trick does. Every break looks the same: the middle drops, the V slides, it stops. Claude first tried letting the rider step off. Nothing changed that mattered. The board slid 10 to 50 centimetres in a straight line, still one stiff V. Then it built the two halves as separate bodies joined by the grip tape. The first version clapped shut like a book. After two corrections it folded and slid differently for each trick. It also looked fake, and I had it thrown away. It rested on too many guesses at once: the weight of each half, the tape, where the feet are and when they leave.

The marks are what showed me the next thing. With them on the timeline I could see that the speeds were not what they said. Before the ⅒× mark the pop played at 0.4. At the 1× mark the speed was 0.11, still nearly full slow motion, and real speed only arrived 0.09 seconds later. Claude moved each mark to where its speed is actually reached and took the slowed pop out of Custom. In the Broken deck view Custom still dropped to about 0.05 around the break, long after its 1× mark, because it had inherited Ramp's second slow-down. That went too.

Custom matched after that. Ramp did not, and I kept saying so. Claude measured it on the page, frame by frame, and the fault was in Ramp on every trick. It did not return to real speed at the catch. It climbed back over about a tenth of a second and only reached real speed 0.09 seconds after the catch. The fall from the catch to the floor lasts about 0.15 seconds, so more than half of it was still slowed. On screen a Kickflip's fall took 0.38 seconds where its real length is 0.17. Every trick was stretched to between 2.2 and 2.6 times. On a breaking run, with the second slow-down, real speed lasted about 0.06 seconds. Two days earlier Claude had told me the fall in Ramp was shown at real speed. It wasn't. Part of the floating I had complained about was this.

Ramp is now back at real speed at the catch and stays there, through the landing or the break. The second slow-down is gone from Ramp as well. A break can be watched slowly at a quarter, at a tenth, or in Custom with the 1× mark dragged past it. Claude checked all 32 clean runs: the flight plays at 0.09, real speed is back at the catch, and the fall on screen is its real length.

With a hard switch something was missing, and I couldn't say whether that was taste. Claude thought not. A change of playback speed that happens at once reads as the board being pushed, not as time resuming. The old gentle climb had done a job. It had only been in the wrong place, spending itself on the fall. It now happens earlier, over the last tenth of a second of the flight, and ends at the catch. Custom does the same before its 1× mark. The cost is that the very end of the rotation is no longer in full slow motion. Claude also drew that stretch on the timeline as a band closing to a point. I didn't like it, and the plain band came back.

Twice that afternoon Claude built something I had only asked about. I had to say so. A question is not an instruction.

The last thing was the names. A view called Flip mechanics could be showing an Impossible, which is not a flip. That view and Broken deck used the same camera under two names, and Flip mechanics and Rotation and catch could not be told apart from what they were called. Claude's first proposal named all five by moment, Flight and Landing with a dot between. It made Truck response and Deck flex generic, and I didn't want “flight” as the name of a view. What stayed is simpler: Orbit View, Top View, Truck Response, Deck Flex, Broken Deck, in that order, written like the tricks with every word capitalised. The buttons followed: Clean Run and Reset View, and the status words Deck Broken and Did Not Land. Sentences stay sentences.

For the recording I asked for less of the same and one new thing. One slow shot of the deck flexing is enough. The break plays in Ramp before its slow replay. And there is a shot I had wanted for a while: the Kickflip stops in the air with the graphic facing up, and the camera goes once round it. The first version stopped everything and then moved. It now sets off before the board stops, gets going quickly and takes its time to settle, and the flip is under way again before the camera has arrived. Later the same day I reworked that shot myself, because it still did not feel like one movement. One fault was left: the camera pushed in, lost its speed for a moment, and only then began to go round. Claude corrected the entrance, so the camera now pushes in without stopping and is already circling while the board is still moving. I also asked for two more changes. Strobe was the only feature of the page the video never showed, so there is now a shot of the 360 Flip in Ramp with Strobe on, while the camera turns part of the way round the exposures. And the break no longer plays in Ramp: it plays as the Broken Deck view opens, in Custom with my marks.

Apart from correcting how the broken deck reaches the floor, the changes were in playback and the interface. The clean runs and the inputs used to generate Variations stayed the same. What changed is how they are shown, and how honestly the page says what speed it is playing. I only found the fault in Ramp because there were two marks to drag, and their labels had to be true.

## What the model does, and what it doesn't

The present experiment uses a Three.js skateboard model and a custom rigid-body motion system. It represents gravity, translation, angular motion, ground contacts, rolling resistance and simplified responses to forces from an unseen rider. Each clean trick is prepared and recorded so the timeline can move backward and forward deterministically. The viewer can change the camera while it plays. Playback can run at a fixed speed, in Ramp or in Custom, and clean runs cycle through a small fixed set of jump heights. Variations use the same simulator with small changes to physical inputs, recorded once per attempt so they can be replayed and scrubbed. On the ground the trucks articulate on their bushings, and after a landing the unseen rider can sway sideways over their feet and shift pressure across the deck.

The rider inputs are not motion capture. The mass and inertia are estimates, and so are the bushing stiffness, the give in the legs and the rider’s reaction time. The clean-run solver still works toward successful catch poses. Several foot interactions are approximations, and a few tricks use cleaner torques instead of all their force inputs being applied through contact points. The catch is not a complete biomechanical model. The trucks steer less than real ones because they pivot about the axis they were drawn with. The deck-flex magnitude uses the approximate positions and forces of the feet, but its deformation profile remains a visual approximation. It is drawn at its calculated scale, and the bend does not act back on the motion. A break is triggered when that approximate bend exceeds a threshold derived from an assumed deck strength, itself lowered by eye; the split, fold and resulting motion are simplified rather than a coupled structural fracture simulation. Clean jump heights and landing attitudes still cycle in a fixed order, and each run carries a small sideways lean set by hand. Variations use bounded, reproducible changes to physical inputs. They include occasional feet-together, stiff-legged landings that can exceed the estimated break threshold. They are not random samples from measured skater behaviour, and neither the landing outcomes nor the breaking frequency has been validated against an instrumented skateboard or measured rider forces.

The slow-motion footage helped us see errors in timing and shape. It could not supply every missing force, contact and trajectory. A single camera angle can obscure depth; a panning camera makes measuring height unreliable. One skater's kickflip is not a universal template for every skater and every trick.

I need those limits written down. Otherwise it becomes too easy to point at twelve successful landings and call the whole thing solved.

## After all those rounds

I went into this expecting code generation to make a small creative experiment easier. It did generate an extraordinary amount of code, quickly. It also produced a series of reasonable-sounding explanations for results I could plainly see were wrong.

I lost count of the corrections that looked complete in a report and incomplete on screen. A solver converged. A landing was numerically stable. No geometry went below the floor. The simulation reached its target. None of that answered the question I was asking when I pressed Play.

I wanted to feel the board's weight. I wanted the pop to have consequence, the flick to disturb more than one axis, and the catch to interrupt a moving object rather than close an animation. I wanted to see it land and carry on.

I also had to learn when to stop asking for more complexity. We tried curves, better curves, gravity arcs, invented impulses, motion references, a custom rigid body, a stronger rider model, a softer catch, more honest contact forces. Some changes really helped. Others made things worse or hid the problem somewhere else. What helped was catching the small places where the board stopped responding to forces and started obeying an instruction.

The trucks were another example. Claude twice recommended leaving them rigid, and both times its measurements missed part of the problem. A model that is too stiff in one place can make everything around it look fine. What I remembered from standing on a board wasn't evidence, but it was a reason to ask what exactly had been measured.

Some of the last improvements weren't in the model at all. They were in how it was shown: where the camera travelled, when the slow motion started and ended, whether two replays were allowed to differ. I had spent many rounds asking for better physics when part of what bothered me was the presentation of physics that was already there.

The current version is substantially better than the first. It still isn't perfect. I suspect I will keep noticing things. But I'd rather leave the imperfections visible and accurately described than pretend this is a faithful demonstration of skateboarding physics.

I had been trying to make every landing look right. Giving up the guaranteed landing made the experiment feel more like skateboarding to me. The imperfect attempts are something I can watch without knowing the ending in advance.

For me, the most interesting thing here is that gap between an outcome that computes correctly and an action that feels credible. The model can hit the right pose, and I can still feel that something is off before I can put it into words. My eyes are involved, obviously. So is the memory of weight shifting through my feet, of a board sometimes doing exactly what I asked and sometimes not, and of catching it before the ground makes the decision for me. I kept trusting that memory enough to ask another question.

I don't think the conclusion is that these tricks can only exist in real life, or that a computer could never reproduce them. I have no evidence for either claim. What this experiment showed me is how much can be lost between a real action and a simplified description of it. The formulas can be right and the inputs can still be wrong. A clean landing on the screen is not proof that we've understood how it was made.

## A second build beside the first (18 November 2026)

Everything above describes the Board Motion I published. On 18 November I asked for a broad review of it: performance improvements that kept the quality, bugs, inconsistencies in the physics, tricks that were inaccurate, and anything else worth fixing. I wanted the result as something I could run beside the original, and I left the original files alone. The day went through a series of packaged builds. The first of them was already called "v2", and it is not the same build as the `v2` folder this journal now lives in, which holds the last of the series and the work done on it afterwards. What follows is that day in the order it happened. The numbers in each part belong to the build and the test they describe, and several of them were corrected later the same day. I have left the earlier ones where they were written.

The first pass kept two kinds of work apart on purpose: how the page draws and what it keeps, and how the board moves. It changed only the first.

- The page renders on demand: during playback, while the camera is easing, or on interaction, and not otherwise. While the camera is moved around a paused board the pose and the shadow map are reused.
- The board's geometry stays indexed.
- The cache of recent variations is capped at eight recordings. The clean runs are kept, and the run on screen and the examples the views have selected keep their own references.
- The clean runs of the other tricks are prepared while the browser is idle and nothing is playing, so choosing a trick later is immediate.
- Opening Deck Flex or Broken Deck no longer searches through candidates. The example is chosen in advance.
- Strobe's exposures are articulated like the board itself: each one samples the wheels' spin, the hangers' rotation, the bushings' position and the deck's flex. The deck's visible geometry and its shadow follow the bend, and the break.
- If WebGL is not available, or its context is lost, the page says so instead of showing an empty stage, and the basic controls stay usable.
- The keyboard works throughout. The two marks of the Custom speed move in 5 ms steps with the arrow keys, 50 ms with Shift, and go back with Home. Moving between speeds skips the ones a view has switched off.
- The timeline tells three moments apart: the soles engaging, the impact with the floor, and the wheels touching down. A failed attempt can show the deck's impact. Ramp still takes its timing from the scheduled descent.

That revision deliberately kept the original catch forces and the original wheel-contact model, so that it could be checked against the published build number for number. The comparison found identical trajectory samples for all 32 clean recordings, for the first 60 variations of each of the original 12 tricks, and for all 12 Broken Deck examples. Those 720 variations reproduced the same 437 landings, 254 misses and 29 breaks. For that first regression check identical motion was the intended result. It is also why my first test of it could look almost the same as the original: it was. The geometry was checked by comparing triangle positions, normals, UVs and material groups. Startup was checked with a simulated DOM, and with the WebGL fallback.

One benchmark was run, on one case: opening the Deck Flex view on the Double Kickflip with the clean runs already cached. Over six runs the median fell from 124 ms to 16 ms when the search for a candidate was replaced by the preselected run. That measures the simulation work of opening a preset and nothing else. Frames per second in a browser, GPU performance and the freezes I reported later were all outside it. That first package was built to run offline and bundled Three.js r179. My original loads r169 from jsDelivr.

## The grip experiment that stayed an experiment (18 November 2026)

After that first build I asked whether the physics had changed at all. It had not, by design. So one question was isolated: does the board lose its spin too abruptly when the feet engage?

To look at it we built two separate comparison pages, `A-Original-Catch.html` and `B-Progressive-Catch.html`. Both opened paused 35 ms before the modelled catch of a Backside Pop Shuvit and played at ⅒×. The idea was that I could watch the tail square up with the same approach in each.

A used the existing sideways grip limit from the first instant of the catch. B started at 75% of that limit and rose to 100% over 25 ms. The timing of the catch, the trajectory before it and the vertical contact law were the same in both, and so was the wheel-contact model. The experiment covered only the three clean jump heights of the Backside Pop Shuvit. The rest of the lineup stayed on the baseline.

| Jump | Absolute yaw speed at catch | At catch +20 ms, A → B | B first wheel contact compared with A |
| --- | ---: | ---: | ---: |
| Normal | 995°/s | 396 → 470°/s | 1 ms earlier |
| Higher | 879°/s | 373 → 436°/s | 6 ms earlier |
| Lower | 1,056°/s | 47 → 218°/s | 37 ms earlier |

All three runs landed in both versions. The speeds are about the world's vertical axis: the board's spin across the floor. B kept more of that spin after the feet engaged. The lower jump changed far more than the other two, both in the spin that was left and in when it touched down.

This was the point at which I asked what A and B actually were, whether A was something new, whether only the Pop Shuvit had changed, whether B was "fake", and whether a progressive grip was even the best option. The answers were plain enough. A was the baseline, on a new comparison page. B was a narrow parameter experiment on that one trick. It was not fake in the sense that it really changed the simulated sideways grip, but the curve was one we chose: the 75% and the 25 ms were modelling choices. We had no measured foot-force data and no live visual validation to say that the curve was realistic or that it would generalise. Later releases left B out. What I can record is the limit of the evidence and what shipped. The exact reason for the release decision was not written down.

Two other changes to contact are easy to confuse with this one, and they are separate.

The rounded wheel tread came in its own change, with the return to r169 described in the next chapter, and did carry forward. It moves the modelled contact point toward the loaded edge of a leaning wheel, and uses that point in the contact velocity and in the hanger torque. Before it, the reaction point sat directly below the wheel's centre. Near level the contact is shared across the flat band of the tread, so the force does not jump as the lean crosses zero. It is a correction from geometry. The tutorials supply no measured wheel, bushing or rider forces.

The third is the sole-overlap change later the same day, described further down: what happens to the edge of a shoe that hangs past the rail. It has nothing to do with either of the other two.

## Thirteen guides and one invention (18 November 2026)

I pointed to the [Skatedeluxe flatground index](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/) and asked for what the app did to be compared with the instructions and the videos. The first review still covered the original mixed lineup. Some of its twelve tricks had no Skatedeluxe guide of their own, so those rows used other references, or comparisons with the tricks they are made of. That came before I decided that every ordinary trick had to have a guide of its own.

The early packages of that review, on the old lineup:

- The Backside Pop Shuvit's main burst was moved closer to the tail strike: in one release from about 30 ms after it to between 4 and 8 ms. The Frontside Pop Shuvit was retuned for a scoop close to the pop as well, its delay varying with the jump height.
- The Varial Kickflip and the Varial Heelflip were given their combined forces earlier, from 40 ms to 4 ms and from 40 ms to 12 ms.
- The normal 360 Flip engaged later and reached about 352° of backside turn when the feet came on, up from 329° in the comparison before it. Its higher jump was tuned too. The Hardflip was pointed toward the steep style. The Inward Heelflip was retuned to reach the catch closer to level. The single and double Kickflips and Heelflips kept their recorded trajectories in that round.
- Each release reported its own 720 attempts, for the lineup it had: 414 landings, 274 misses and 32 breaks in the one called Final; 411, 277 and 32 in the one called Repair; and 410, 277 and 33 in the later revision with the rounded tread. They are three different builds and their numbers are not a trend.

The Impossible was in that lineup, and it is where the numerical approach showed its weakness; its story is in the list further down, because it ended with the trick being removed.

There is a part of this period I can only record, not explain. Some of these rounds shipped as offline builds with Three.js r179 bundled into the page. While I was using them I had severe freezes. They froze or slowed my whole machine, and I asked why Three.js had been bundled at all. We went back to loading r169 from the CDN, as the original does, and carried the selected fixes forward, the removal of the Impossible among them. That version worked better for me. The cause of the freezes was never isolated. What the record supports is my experience and the change of packaging. It does not establish that r179 itself was responsible, and we never measured a reliable improvement of the second build over the original in a browser.

I then asked for twelve tricks, each with its own Skatedeluxe guide that opened in a new tab, and for language a skateboarder would recognise. That brought in the clearer cues for nose and tail, heel side and toe side, frontside and backside, and it separated the board's spin from the simplified cue for the rider's turn. The twelve were the Kickflip, the Heelflip, the Backside and Frontside Pop Shuvits, the Ollie, the Varial Heelflip, the 360 Pop Shove-It, the 360 Flip, the Hardflip, the Frontside and Backside 180 Ollies and the Backside Bigspin. The Varial Kickflip, the Inward Heelflip, the Double Kickflip and the Double Heelflip had left by then. A thirteenth trick and one invented extra were added after that. The links were there so that I could check the exact references myself, because I was still not convinced. The app carried them for most of the day. I took them out of it at the end, because I want people to stay with the board, and they are kept here:

- [Ollie](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-ollie/)
- [Kickflip](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-kickflip/)
- [Heelflip](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-heelflip/)
- [Backside Pop Shuvit](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-pop-shove-it/)
- [Frontside Pop Shuvit](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-fs-pop-shove-it/)
- [Varial Heelflip](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-varial-heelflip/)
- [360 Pop Shove-It](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-360-pop-shove-it/)
- [360 Flip](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-360-flip-treflip/)
- [Hardflip](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-hardflip/)
- [Frontside 180 Ollie](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-fs-180-ollie/)
- [Backside 180 Ollie](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-bs-180-ollie/)
- [Backside Bigspin](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-bs-bigspin/)
- [Backside 180 Kickflip](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-bs-180-kickflip/)

The written guides, the photo sequences and the videos are three different kinds of evidence, and they were not all used equally. I said the first Ollie and Frontside Pop Shuvit revisions had been rushed, and asked for comparisons frame by frame. The tutorial players stalled, so the documented comparisons used the published sequence photographs.

The work on the tricks, with its missteps:

- **Impossible.** At first it came back to a similar orientation without completing the wrap it is named for. A later solver check required a full end-over-end turn, and one revision lowered the modelled apex from about 1.06 m to 0.80 m. It still failed the only test that matters. I shared [a video of the trick](https://www.youtube.com/watch?v=tT5dlPf4tVs) and said the result looked like a flying board, and that the landing and the truck response were wrong. It had no dedicated Skatedeluxe guide either. I said it should have been removed earlier, instead of being presented as a convincing trick on the strength of a solver pass. It was removed. A wrap that was numerically complete had answered only part of the problem.
- **Ollie.** Compared at frames 3, 5 and 7 of the sequence: the tail pop, the front foot levelling, and the descent. The normal run had been about 14° nose-up at the apex and was tuned to be level there. I still questioned how horizontal it looked, asked for the front foot's movement to read more strongly, and said the high landings felt static.
- **Frontside Pop Shuvit.** Compared at frames 6, 9 and 11. In the run before that comparison the nose struck the floor again 129 ms after the pop. The next revision removed that strike in its clean runs and in the 60 seeded attempts tested for that trick. The normal catch tested then still began at about 175° of spin.
- **Backside Pop Shuvit.** It used to dive 36 to 46° nose-down in its clean runs. Its revised pop and catch produce roughly 4 to 5° of maximum nose-down tilt in those runs. Both Pop Shuvits still use a simplified catch, and their heading can change after the feet engage. Claude's later finding, that the scoop tricks flatten too early, comes after these changes and partly because of them.
- **Varial Heelflip, 360 Flip and Hardflip.** Retuned. The Hardflip was described as the steep style.
- **Crosswire 540.** An invented extra, not a real trick: the board spins 540° frontside with two heelflips and a 180° frontside rider cue. It has no tutorial reference and is labelled as experimental.
- **180 No Comply.** Added at my request as the thirteenth trick, and it went through four attempts. The first modelled a short plant of the front foot, then the back foot guiding the board and the front foot returning. In the launch model it inherited, the guidance still depended on a short burst, and adjusting the later return of the foot did little to make the takeoff read correctly. The second was shorter and lower, and still barely began its turn before the push-off; my Strobe screenshot made the difference from the [Skatedeluxe sequence](https://www.skatedeluxe.com/blog/en/trick-tips/skateboard/flat/how-to-no-comply/) plain. The third softened the pop and started the guidance during the plant: the turn at push-off went from about 1° to 21°, and the peak lift from about 23 cm to 18 cm. Strobe sampled the plant, the pop, the guided turn, the front foot's return and the landing, and an orange circle on the floor marked roughly where the foot was planted. I said it still looked like another trick, and that the circle made the view more confusing. It was a visual failure and not a numerical one: the runs landed. The circle and the No Comply were removed.
- **Backside 180 Kickflip.** It took the No Comply's place. A Frontside 180 Kickflip was tried first; the backside one was chosen because it had a usable solution and a guide of its own. Its first clean solve caught the board at around 171° of backside turn and was checked numerically at about one full kickflip and 177° backside at first wheel contact, with no second deck strike in the clean run. That check confirmed the end pose and nothing about the order of events on the way, which is what Claude's comparison later changed.
- **Backside Bigspin.** It originally caught after about 346° of board rotation. It was changed to catch around 270°, with the rider cue around 90° backside, and a simplified turning moment after the feet engage to stand for the rider finishing the turn with the board. Two of its three clean jump heights use a tuned torque for the scoop. This was the first of two corrections. The second, to what the board does after that catch, came with the audit.

This is the reference table as it stood at that point. The angles come from the simulator, are rounded and describe the default clean run. The Skatedeluxe write-ups describe the footwork, the direction of the spin and the catch; their photo sequences show poses at different stages, with perspective and timing varying by trick. Three of its rows were changed by the audit later in the day (the two 180 Ollies and the Backside 180 Kickflip), and the Bigspin's last figure too.

| Trick | Reference checkpoint | Board in the simulation |
| --- | --- | --- |
| Ollie | Nose rises after the tail pop, then the front foot levels the board | About 39° nose-up at its steepest, level at the catch |
| Kickflip | Toe flick off the nose, one flip and catch over the bolts | One kickflip, level at catch |
| Heelflip | Heel exits at the nose, flip opposite the kickflip | One heelflip, level at catch |
| Backside Pop Shuvit | Tail scoops behind, board stays grip-side up | 174° BS at catch, 183° at first wheel contact |
| Frontside Pop Shuvit | Tail pushes forward, board stays grip-side up | 175° FS at catch, 189° at first wheel contact, then settles |
| Varial Heelflip | Frontside scoop and heel flick in one jump | One heelflip, 178° FS at catch |
| 360 Pop Shove-It | Back foot supplies the full backside scoop | 346° BS and 14° nose-up at catch, 364° BS at first wheel contact |
| 360 Flip | Backside scoop and kickflip together | One kickflip, 352° BS and 9° nose-up at catch, 364° BS at first wheel contact |
| Hardflip | Frontside shove and kickflip, with both flatter and steeper styles described | Steep style, one kickflip and 179° FS at catch |
| Frontside 180 Ollie | Board and rider turn together | 175° FS and 13° nose-down at catch, 183° FS at first wheel contact |
| Backside 180 Ollie | Tail goes behind the rider, board and rider turn together | 177° BS and 13° nose-down at catch, 185° BS at first wheel contact |
| Backside Bigspin | Rider catches about halfway through their backside 180 and finishes the turn with the board | 270° BS at catch, around 90° on the rider cue, then 363° BS at first wheel contact |
| Backside 180 Kickflip | Backside 180 and kickflip in the same jump, catch over the bolts | One kickflip, 171° BS at catch and 177° BS at first wheel contact |

What I took from this round is the same thing the first project taught me, and I still had to learn it again. Several of these builds passed their numerical checks and still looked wrong in playback. A solver reporting a landing did not establish that the pop, the flip, the catch or the roll-away looked like skateboarding.

## High Ollies, and a landing view that showed the wrong thing (18 November 2026)

Variations were widened in this build. As it was described then: they sample the available jump heights and change the bias toward the nose, the tail or either edge, the softness of the knees, the foot placement, and the timing between the feet. The Ollie also varies the front foot's levelling force. A less common off-centre catch puts the feet to one side and delays the back foot. Hard landings bring both feet near the middle with stiffer legs. The simulation resolves the outcome from those inputs, attempt numbers stay deterministic, and the rider and the feet stay invisible.

High Ollies appeared here for the first time. A clean Ollie rises nose-up, levels near the top and comes down to the wheels; the normal simulated Ollie was recorded as peaking at about 37 cm, and the high ones turned up at irregular intervals in Variations, 12 of the first 60 attempts peaking at 55 to 57 cm. Those heights are of the board's centre above the floor. The heights in the later chapters, 31 cm for a normal Ollie and 49 for a high one, are how far the board rises above where it rolls, about 6 cm less. They are the same jumps. The release called Mixed Variations named Ollie 3 as a high miss, and 20 and 25 as high landings with opposite pitch at touchdown. The contact fixes later in the day changed what those attempt numbers do. I kept pointing out that ordinary play could still feel monotonous, even with those cases in it. Their landing can load the nose, the tail or one side first, depending on the catch and the landing input. The high jumps are simulated attempts. Their heights and how often they occur are design choices.

A screenshot of mine, of a Kickflip in Truck Response, exposed a separate problem with the landing presets. The view used to choose, among the runs that eventually rolled away, the one with the strongest hanger movement. That rule picked Kickflip 115, which near touchdown had already added up about 423° of flip and first touched on one wheel with the deck banked about 66°. It still passed the check that it eventually rolled away. The hangers moved a great deal, but what the view was showing was a board falling off its edge, not trucks answering a landing. The candidates are now screened at the catch and at first wheel contact before they are ranked, extra deck strikes are excluded, and the tilt around touchdown is checked. Its replacement, Kickflip 156, touches down banked about 4° and still shows about 8.4° of hanger movement afterward. The contact changes later in the day led to more re-pinning, and each of those is recorded under the revision it belongs to.

From there the two landing views changed how they work. **Truck Response** and **Deck Flex** keep the selected trick, load one pinned variation that has been screened at the catch and at first wheel contact before it is ranked for hanger movement or for flex, and start between the catch and first wheel contact at ⅒×. The truck readout shows the nose and tail hanger angles relative to the deck, the flex readout the simulated bend in millimetres. The Ollie examples peaked at about 12° and 5.5 mm. That makes 28 pinned runs, two for each trick.

The check at the end of that round covered the clean runs and the 28 pinned landings for finite simulation data and wheel contact, and the clean runs for spin, flip count and unwanted deck contact after the pop. The retained tricks were checked against the previous build for identical clean trajectories. All 28 examples passed those numerical checks. Exact pose matching against timed video, and live playback in a browser at normal speed, were not verified.

## What the audit found (18 November 2026)

I then gave the build to Claude. I had meant it to test and fix in one pass, but the first instructions told it to stop after an audit, so it did: launch the app, compare all thirteen tricks with their guides, and tell me which problems were real. It checked play, scrubbing, Strobe, the views and a 375 px layout, read the text of every guide and looked at the photo sequences, measured each clean run from the recorded poses, and scrubbed the decisive frames in the browser. A variation took about 17 ms to simulate.

Its count was five tricks matching the phases it checked, eight that did not, and the Crosswire unverified because it has nothing to be compared with. Most of the mismatches were the board's pitch or the timing of the catch. Then I told it to fix what it had found, one thing at a time, with the same cases measured before and after.

**Reset after Broken Deck.** After leaving the Broken Deck view with Reset, the page highlighted Clean Run while the timeline still held the broken recording: 1.83 s long, "Deck Broken" under the play button. Leaving a view now puts the clean run back. The same sequence gives the 2.36 s clean run and "Landed", and it holds when the trick is changed inside the view and when Reset View is used instead.

**The soles lost the deck in the air.** This was the serious one. In a variation the feet can come down a little to one side. In the air, a sole edge more than 3 mm past the rail was dropped. The soles span 190 mm on a deck 210 mm wide, so feet only 13 mm off centre lost both contacts of one side at once, and the other two tipped the deck. Ollie variation 13 was level at the catch and 39° on its rail 0.15 s later, and still counted as landed. Variation 3, a high Ollie, tipped to 81°, turned over and tumbled. Nine of the first 24 Ollie variations touched down at 35 to 48° of lean. The quick fix on offer was to cap the sideways offset at 10 mm. That would have hidden the threshold and left it in place, so it was only used as a comparison. An overhanging edge now presses at the rail, as it already did on the ground.

| Sideways offset of the feet | Ollie before | Ollie after | Kickflip before | Kickflip after |
| --- | --- | --- | --- | --- |
| 10 mm | 5° | 5° | 5° | 5° |
| 16 mm | 39° | 6° | 88°, no landing | 5° |
| 50 mm | 31° | 12° | 89°, no landing | 12° |
| 100 mm | 13° | 13° | 89°, no landing | 12° |

(Largest lean of the deck after the catch, same inputs.) On the same seeds, Ollie 13 touched down at 2° instead of 39°, Ollie 3 landed, and Ollie 18 still broke its deck, as it should.

One test put a number on how much of the earlier missing had been this fault. Over the first 20 variations of all 14 tricks, 280 runs, the count went from 163 landed, 103 missed and 14 broken to 215 landed, 48 missed and 17 broken. Those figures belong to that test, on the build just after this fix. The Kickflip then missed once in 20.

**A landing on the rail has its own name.** A run that stays tilted more than 25° for over 60 ms after first wheel contact is no longer just "landed", even if the board drops onto its wheels afterward. The timeline says "Landed on the Rail" and the variation's line says that it comes down on its rail before it settles on the wheels. These runs are excluded from Truck Response and Deck Flex. After the contact fix two Truck Response examples had lost most of their hanger movement and were pinned again: Heelflip 134 became 103, and Backside 180 Kickflip 26 became 188, both with about 12° of hanger movement.

**Bigspin.** The catch near 270° was right, but what followed was not. Once the feet were on, the board sped up from 800 to about 1,300°/s, overshot the full turn by 12° and was snapped back by the wheels at nearly 500°/s. The turn that is left is now paced over the time that is left, steady first and then slowing evenly into the landing. The catch is still at 270° with the rider cue at 90°. The overshoot is under 1°, the snap-back 13°/s or less, and the board meets the floor at 360°. It still speeds up slightly under the feet, from 800 to 821°/s: a quarter turn in 0.13 s cannot be finished by slowing down alone.

**Backside 180 Kickflip.** The earlier check had only confirmed the end pose. The photo sequence shows something the end pose does not: the board is upside down early in the turn, the feet come on with the board about end-on to the camera, and the rest of the 180 is turned with the feet on it. The build caught at about 171°, with the whole turn done in the air. The catch is now at 105°, with the flip complete there, and the feet bring the board round to 179° at wheel contact.

**The 180 Ollies.** Both dived, the backside one 26 to 31° nose-down from the middle of the flight. With the front foot held on the deck for longer (0.12 s instead of 0.06) they stay within about a degree of level from 70° of turn to the catch, which is what the backside sequence shows.

**Flip readout.** The readout added up the turning about the board's long axis, and on a trick that also spins or pitches steeply that sum runs ahead of the flips you see. A Hardflip's one flip read 532°, the 360 Flip 420°, the Crosswire 788°. It is scaled now so that each trick's clean run reads its own flip at the catch: 358°, 360° and 717°.

**Small things.** On a phone the Broken Deck message no longer offers the Custom speed, which is not there. The view still opens on the Heelflip whatever trick was selected; that was left as it is. Truck Response and Deck Flex followed the board only along its travel, so a trick that came down off its line sat at the edge of the picture or outside it; the Crosswire, which lands about 0.4 m to one side, showed a corner of the deck. The camera follows it sideways as well.

## What changed our minds, and what stays open (18 November 2026)

Three results went against what we expected.

The audit said high Ollies showed no extra weight. The comparison behind that was unfair: it set runs side by side whose feet landed over the bolts, where a deck hardly bends at any height. With the same stance and the same legs the high Ollie does land harder. Feet 30 mm in from the trucks gave 3.5 mm of flex on the normal Ollie and 4.3 mm on the high one; 60 mm in gave 6.1 and 7.4 mm. Nothing in the flex or the impact was changed.

The Hardflip is still wrong, and I know now in which way. In the build the board goes steep with its tail high, the nose 58 to 68° down in the middle of the flight. In the reference it goes vertical with the nose up, between the legs. Claude tried about fifteen starting points for a nose-up solution. Each one either struck the floor again just after the pop, turned backside instead of frontside, or needed a lift no rider gives. The motion was left as it was and its description now says what it shows.

The scoop tricks flatten too early: both Pop Shuvits, the 360 Shove-It, the Bigspin and the Varial Heelflip are level within the first quarter of the flight, where the photographs keep the nose high through the first 90° of the spin. The suspicion was the time the front foot is held on the deck. That was tested and half confirmed. With a shorter hold the Backside Pop Shuvit keeps its nose at 54 to 72° through the first 110°, close to the sequence. But the Frontside one would not land with the same change, and neighbouring values sent the solver somewhere absurd. One number does not fix five tricks. They are unchanged.

I should be exact about what kind of evidence all of this is. The angles are read from recorded poses. The frames were scrubbed in a browser pane. The guides were read and their photo sequences looked at, but not their videos. Through the whole audit the browser pane was in the background and throttled to about two frames a second, so nobody watched these fixes at normal speed, and frame pacing was not measured. The scripts take about 1 ms per frame in ordinary playback and 1.5 ms in Strobe, with no long tasks, which says nothing about why the earlier builds froze.

## Not the same attempt twenty times (18 November 2026)

Once the false tipping was gone, Variations had a new problem, and I saw it on the Ollie first. I could keep pressing play and watch nearly the same attempt again and again. The fault had been supplying most of the variety.

I used the first 20 consecutive variations of each trick as the window, and Claude went through all 14.

The Ollie's 20 came out as 14 clean landings, 5 rough ones and one break, with no miss, and apart from two high ones every jump was between 28 and 35 cm. The two 180 Ollies and the Backside 180 Kickflip jumped the same height every time, because each has only one solved jump height to sample from.

Before adding variety through the feet, the far-off catch had to be believed. With the feet 100 mm to one side the deck leaned only 12°, and a low lean alone does not prove the catch is credible: the rail was holding up a sole edge however far out the shoe was. An overhanging edge is now supported only while at least half the shoe is over the deck. Before the change an Ollie caught 100 mm off centre landed leaning 13°. After it, an Ollie caught 110 mm off centre leans 15° and no longer lands: the board comes down leaning, carves away and has turned 20° off its line within a second. One weakness is left: once only the inner edge of the shoe presses, the tipping does not grow smoothly with the offset. A Kickflip 100 mm off ends on its rail. Up to about 95 mm both are saved, leaning about 12°.

Then two things were added to what a variation changes, as ranges and not as outcomes.

- **How hard the rider jumps.** Each attempt pops a little harder or softer than the trick was solved for: up to 20% either way on the Ollie, 8.5% on the 180 Ollies, 6% on tricks that flip or spin. The burst stays the one solved for the trick's own jump, so a different pop also leaves the board a little over or under its rotation when the feet come back.
- **The Ollie's own ranges.** Its feet may come down up to 35 ms early or late instead of 16, the front foot's levelling varies by 30% instead of 17%, and an off-centre catch is more common and lands anywhere from 50 to 140 mm to one side.

The first try was smaller, 13% on the Ollie's pop and nothing else, and it changed almost nothing: the jumps moved to 26 to 37 cm and there was still no miss in twenty. Widening the flick and the scoop was also tried and dropped. The Kickflip and the Heelflip still missed once or twice in twenty either way, because the catch in this model stops a flip that arrives 30 or 40° short or long, and the wider ranges only made the Varial Heelflip and the Hardflip miss more.

The Ollie's first 20 now run from 25 to 39 cm with two high ones at 49, and from 0.31 to 0.52 s in the air. Variation 1 is the miss: 133 mm off centre, it touches down leaning 22° and does not stay on. Variation 12 is the quick low one, 25 cm. Variations 3 and 20 are the high ones. Variation 18 still breaks the deck. Over the same window the whole lineup gives 205 landings, 58 misses and 17 breaks, and no sustained rail landing.

| Trick | Land / miss / break | Jump heights |
| --- | ---: | --- |
| Kickflip | 19 / 1 / 0 | 33 to 43 cm |
| Heelflip | 18 / 2 / 0 | 33 to 43 cm |
| Backside Pop Shuvit | 17 / 2 / 1 | 27 to 36 cm |
| Frontside Pop Shuvit | 11 / 8 / 1 | 26 to 36 cm |
| Ollie | 18 / 1 / 1 | 25 to 39 cm, two at 49 |
| Varial Heelflip | 12 / 6 / 2 | 34 to 43 cm |
| 360 Pop Shove-It | 14 / 4 / 2 | 43 to 58 cm |
| 360 Flip | 9 / 11 / 0 | 41 to 54 cm |
| Hardflip | 16 / 2 / 2 | 41 to 50 cm |
| Frontside 180 Ollie | 19 / 1 / 0 | about 35 to 40 cm |
| Backside 180 Ollie | 15 / 3 / 2 | 33 to 38 cm |
| Backside Bigspin | 17 / 0 / 3 | 41 to 55 cm |
| Backside 180 Kickflip | 18 / 0 / 2 | 40 to 45 cm |
| Crosswire 540 | 2 / 17 / 1 | 52 to 62 cm |

That table is one build and one sequence. The pass after it changed every row. The Frontside 180 Ollie's jumps now run from about 35 to 40 cm and the Backside 180 Kickflip's from 40 to 45. Attempt numbers are still deterministic: the pop uses a twelfth number drawn after the eleven each attempt already had, so nothing else about an attempt moved.

Because the attempts changed, the pinned landing examples had to be checked again. Four Truck Response examples no longer showed a controlled landing or enough hanger movement and were pinned again: Kickflip 156 became 150, Varial Heelflip 17 became 71, 360 Flip 146 became 211, and Crosswire 78 became 155. All 28 land with the deck within 6° of level at first wheel contact; the weakest shows 8.8° of hanger movement and the shallowest 5.1 mm of flex. The clean runs of all 14 tricks are unchanged by this pass, and Reset after Broken Deck still returns the clean run.

The journal was repaired in the same pass. An earlier edit had put a "Current build" block at the top and the history felt out of order. The first instructions for the repair pointed Claude at archives it did not have; the baseline it did have was the original notes file beside the original project, and that is what it compared against. The day became dated chapters after "After all those rounds" and before the technical notes, the block's table, links and measurements moved into them, and removing those chapters and restoring the date gave back the original file byte for byte.

Two things are still true that I would rather not be. The Bigspin and the Backside 180 Kickflip do not miss at all in their first 20, because the feet now carry the board through the end of the turn. And a Kickflip caught well short of its full flip still lands cleanly. Both come from how forgiving the catch is, and that belongs to a pass of its own, with the Hardflip and the early flattening of the scoop tricks.

## Still boring (18 November 2026)

I played the result and it was not good enough. On the Ollie I sat through about fourteen variations that were almost the same before one broke the deck and another failed. Every attempt had changed slightly, and none of that reads as a different attempt. A row of small changes is boring. What makes Variations worth watching is the attempt that genuinely goes wrong, and there were far too few of them, on every trick and not only the Ollie.

Claude first measured what it takes to make an Ollie fail in this model, one input at a time. The answer was almost nothing. Feet 120 ms early or late: lands. The front foot's levelling doubled, or removed: lands. The pop 40% harder or softer: lands. A landing biased until the deck tilts 18°: lands and rolls away. The only things that stop an Ollie are feet far enough to one side that less than half the shoe is on the deck, and both feet coming down stiff in the middle. So the small ranges of the last pass could never have produced a miss, however they were widened.

The same test found a fault. The Bigspin and the Backside 180 Kickflip landed with the feet 150 mm to one side, which no board does. The sideways offset was being taken across the direction of travel. Those two tricks are caught with the board part-way through its turn, so for them "across the travel" was along the deck, and being off centre cost nothing. The offset is now taken across the board as it lies at the catch. With that, every trick fails once the feet are more than about 100 to 130 mm off.

Then the ranges were rebuilt around the mistakes that really end an attempt:

- **Off-centre catches** are more common and reach from 50 to 160 mm, so about half of them are saves with the deck leaning and half are misses. How common depends on what else the trick can miss by: half of an Ollie's ordinary attempts, four in ten on the tricks the feet carry round, a third on the Kickflip and Heelflip, a quarter on the shuvits, and under one in ten on the tricks that flip and spin at once, which miss often enough on their own rotations.
- **A badly wrong input now and then.** Most attempts are still a little off, but a share of them get a real mistake in the flick, the scoop, the pop or the timing of the feet. The combined tricks are left out of this.
- **Hard landings**, both feet at the middle with stiff legs, are more common: about one attempt in ten, and about one in six on the Ollie.

These are ranges and shares, not outcomes. No attempt is told to miss, and the same attempt number still gives the same attempt.

The first version of this went too far. With the same shares on every trick, the 360 Flip failed 87% of the time, the Hardflip 73% and the Crosswire 93%, which is why the shares now depend on the trick.

Over the first 40 variations of each trick, the share that does not land or breaks the deck is now: Kickflip 43%, Heelflip 33%, Backside Pop Shuvit 50%, Frontside Pop Shuvit 50%, Ollie 35%, Varial Heelflip 33%, 360 Pop Shove-It 60%, 360 Flip 58%, Hardflip 33%, Frontside 180 Ollie 48%, Backside 180 Ollie 48%, Backside Bigspin 33%, Backside 180 Kickflip 50%, Crosswire 540 90%. The Ollie's first 20 are 12 landings, 5 misses and 3 breaks, where the pass before had 18, 1 and 1. Its longest run of landings in a row in the first 40 is 8; it was 16. The Bigspin, which had no miss at all in its first 20, has 6 misses and 7 breaks in its first 40.

Because every attempt changed again, all 28 pinned landing examples were chosen again by the same screen as before: a landing, not on the rail, not a break, within 5° of level at first wheel contact, never tilted more than 13°. The Truck Response examples show 11.3 to 12.2° of hanger movement and the Deck Flex examples 5.4 to 8.9 mm. The clean runs of all 14 tricks are unchanged, both landing views have an example for every trick, and Reset after Broken Deck still returns the clean run.

Some things still land too easily. A Kickflip or a Heelflip caught 30 or 40° short of its flip, or past it, is stopped by the feet and rolls away, because the catch in this model is that forgiving; the Heelflip still has one run of ten landings in a row, from its fifth variation to its fourteenth. An Ollie that comes down with the deck tilted 18° lands. The attempts that genuinely look different are the ones where something visible happens: the board carving away from under feet that came down to one side, a deck ending on its rail or upside down after a flick that was badly wrong, a high Ollie, a quick low one, a landing that bends the deck and one that breaks it.

What I have not done is watch a long run of them at normal speed. The sequences above were read from the simulation and from the page's own line under each variation.

Open at the end of the day: the Hardflip's nose-up path, the scoop tricks flattening too early, the uneven tipping at extreme sole offsets, the catch that forgives a flip caught short, and playback at normal speed with its frame pacing. No solver pass, no Strobe still and no short script timing established those last two.

One thing runs through the whole day and I want it written down. Numerical landings were treated, again and again, as stronger evidence of how a trick looks than they were. My screenshots of the Impossible, of the No Comply and of the tilted Kickflip belong to this record, though they are not shown in this document, because each of them showed exactly where those checks fell short.

## A shadow cut in half, and a variation I could not see twice (18 November 2026)

Two things I found while playing, both late in the day.

The first was the light. In many places the shadow under the board was only half there, and sometimes the board looked as if it floated above the floor. I thought the lighting was wrong. It was not: the lights followed the board along its line of travel and not sideways. The shadow is drawn from a square 1.7 m across that moves with the board, so a trick that came down off its line, or a failed attempt that drifted, left part of the deck outside that square and lost that part of its shadow. The soft contact shadow under the board had the same fault and stayed behind on the line. The key light, the rim light and the contact shadow now follow the board sideways as well. It was checked on the Crosswire's clean run at the moment it is 47 cm off its line, where the shadow is whole under both ends. A failed board can still drift out of the default picture altogether, one Crosswire variation by 1.9 m, because the default camera does not follow it sideways. That is left as it is.

The second was the controls. In Variations every press of Play started a new attempt. I could not watch the same attempt twice, and I could not go to the next one or back to the one before without waiting for the run to end or dragging the timeline to its start. Now Play repeats the attempt on screen, and two arrows go to the one before it and the one after it at any moment, also in the middle of a run. They were beside the Variations button at first; I asked for them to be part of it, so the button now reads ‹ Variations › and the arrows are only there while Variations is the mode. The keys are [ and ]. The arrows are off in Clean Run and inside a view. This changes something the first project did on purpose, that no two presses of Play gave the same attempt. The attempts themselves are the same numbered attempts as before; what changed is who decides when to move on.

Two inconsistencies came out of using it. Clicking Variations when it was already the mode showed its message again, which a view does not do; now it does nothing. And Reset did not reset: it went back to the start and the default camera but left the speed, Custom's two marks and the mode as they were. Reset now puts everything back as the page opens, for the trick that is selected: the clean run at its start, Ramp, the marks where they began, Clean Run, no view, no Strobe, the default camera.

That led to the rest of the bar. Clean Run and Variations are a pair where one is always on, like the speeds, so I asked why clicking the one that is on did nothing and whether it should toggle. It stays a pair: a toggle would have to be a single button, and the pair shows both names. What changed is that the option that is on, in the speeds and in this pair, no longer looks as if a click would do something. The views also stopped locking the speeds. A view now only chooses the speed it starts at, and its message says so. Orbit View, Top View and Broken Deck allow all five. Truck Response and Deck Flex allow the three steady speeds; Ramp and Custom stay off there for a reason and not as a preference: they slow the flight, both views start after it, and they would play exactly as 1×. I asked about it once more, and the alternative was to play the whole trick in those two views whenever Ramp or Custom was chosen. I decided they are right as they are.

## A recording of the second build (18 November 2026)

The second build had no video. The recorder was copied into `v2` and given a new sequence for what this build added, ten shots and about 41 seconds on the real page, frame by frame as before:

1. Orbit View on the Backside 180 Kickflip, clean run, Ramp.
2. The shot that stops the trick in the air and takes the camera once round it, kept from the first video, now on the Crosswire 540, stopped in its second flip with the graphic up.
3. Strobe on the Backside Bigspin in Ramp, the camera turning part of the way round the five exposures.
4. Truck Response on the Kickflip at ⅒×.
5. Deck Flex on the 360 Pop Shove-It at ⅒×.
6. Three variations with the default camera: Ollie 3, a high one that lands; Ollie 1, feet well to one side, which does not land; Heelflip 4, feet to one side, which does not land.
7. Broken Deck on the Heelflip as the view opens, at the Custom speed, and again at ⅒×.

Three things had to change for it to work on this build. The page now draws only when something changes, so the recorder writes the last picture again for a frame the page did not redraw, instead of reading a canvas that may be empty. In Variations, Play repeats the attempt on screen, so the recorder steps to an attempt with the button's arrows. And a shot ends a set time after the timeline itself says the run has landed, failed or broken, not at a time worked out beforehand.

The first take showed one more fault, in the page and not in the recorder. The Crosswire comes down about half a metre to one side, toward the camera, and slid to the bottom edge of the picture as it landed. The default camera now follows the board most of the way sideways. That is the same fault as the cut shadow and the landing views, found a third time.

The recording was checked on stills from each shot. I have not judged it in motion yet.

## Combos (19 November 2026)

The next morning I wanted extras, and the first one I thought of was a combo mode: two or three tricks in one run.

Claude's first answer was the cheap one. Every trick is already a recorded run, so a line could be made by playing one recording after another and blending the joins. It added that it would not attempt the other way, simulating the second trick from the exact state the first one left, because the tricks are solved for one standard run-up. I said that was not good enough for a combo. A row of recordings is a playlist. In a real line the second trick starts from whatever the first landing left you with, and that is the whole point. Claude agreed it had dismissed it too quickly: the tricks being solved for a standard start is not a reason against it, it is what makes the second trick depend on the first.

So that is how it was built.

- **The simulation can start from a state.** It used to start every run from the same standing roll. It can now be handed the state another run ended in: the board's speed and heading as they really were, its lean, the trucks, where the rider is. It hands that state back when it ends.
- **A combo chains real runs.** The second trick is simulated from where the first one ended, and the third from the second. Nothing is joined or blended. Each trick keeps the burst it was solved with, at the same moments after its own start. A miss or a broken deck ends the combo there.
- **A board that turned round is taken as it rolls.** After a shuvit or a 180 the board rolls tail-first, and the next pop comes off the end that now trails, as a skater's would. The simulation treats the reversed board as the same board. Its nose and tail are not quite the same shape, so that is an approximation, and the board is still drawn the right way round.
- **The feet step back to the middle of the board between tricks.**

Before building on it, the same check as always: all 32 clean runs and the first 20 variations of every trick, 280 of them, were compared sample by sample with the build before the change, and every one is identical.

Combos is a third mode beside Clean Run and Variations, and it works like Variations. Combos are numbered, Play repeats the one on screen, and the arrows on the button go to the one before and the one after. The selected trick opens every combo, so the list keeps its meaning: with the Bigspin selected you see what can follow a Bigspin. The number decides the rest: whether there are two tricks or three (six in ten have three), which tricks follow, and what each is given. In three combos out of ten every trick gets its clean inputs, and those are the ones that can come out perfect. In the others each trick has an even chance of clean inputs or the inputs of one of its own variations. The invented trick only ever opens a combo. All five speeds are allowed, and Ramp gives each trick its own slow motion. Strobe is off in Combos, because it lays out one flight and a combo has two or three. The views were off too at first, greyed out, and that was incoherent: from Variations a view could be opened and Reset View gave Variations back, and from Combos it could not be opened at all. There is one rule now. A view opens from any mode, shows the selected trick, takes over for as long as it is open, and gives back the mode and the speed that were in use when it is left.

The camera keeps pace with the board for the whole combo, with the board in the middle of the picture, and the timeline shows Pop, Catch and Land for each trick and names the one that is playing. The panel at the top right first kept the selected trick's name and its explanation, with the combo squeezed into a line under them. That was not accurate: in Combos it now says the combo's number, then its tricks in order, then one line on how it went, and no trick is explained there.

The first numbers, from the first 12 combos opened by each of the 14 tricks, 168 in all: 98 are made to the end and 70 end early in a miss or a break. Of the 63 in which every trick had its clean inputs, 60 are made and 3 are not, and those three are the proof that the state is really carried: nothing was wrong with any trick in them except where the one before had left the board. A second trick given clean inputs landed 87 times out of 89. More than half the combos, 95, have a board that is turned round at some point.

Three examples that can be played again. Kickflip, combo 1: Kickflip, Ollie, Backside Bigspin, all three land. Ollie, combo 1: Ollie, Varial Heelflip, then an Ollie popped off the nose because the board is the other way round, all three land. Kickflip, combo 2: Kickflip, Backside 180 Ollie, Frontside Pop Shuvit, and the third does not land.

Playing them, the wait between one trick and the next felt too long, and always the same. It was: every trick rolled for a full second after its landing before the next one began its run-up, so the next pop came 1.4 s after the landing, every time. The next trick now takes the board over between 0.1 and 0.5 s after the landing, a different moment in each combo, and the pop comes 0.5 to 0.9 s after the landing. The landing is still judged on the whole roll-out as before; only the moment of handing over moved. A quick one finds the board less settled. Over the same 168 combos, 108 are now made, and 62 of the 63 with clean inputs. Kickflip combo 1 went from 6.09 s to 4.51 s. The clean runs and the variations are still identical to the build before.

Three smaller things followed from using it. Combos open at 1×, because the pace of a combo and the wait between its tricks are part of it; the speed in use before comes back when Combos is left, and any speed can still be chosen. The line that says how a combo ended ran out of the panel on one line; it wraps now. And on the timeline the labels Pop, Catch, Impact and Land overlapped at some window widths, because whether a label was shown was decided by a fixed share of the timeline's length. It is measured on the page now: every event keeps its tick, a label that would run into the one before it is left out, and this is done again when the window is resized.

I reported that the Custom speed did not work in Combos. Measured, it did play: a tenth of real speed in each trick's flight. What was wrong was what the timeline showed. The two marks and their zone stood on the first trick only, as if nothing happened to the others, and the second mark could be dragged across the whole combo, drawing one long slow zone that the playback did not follow. Every trick now has its slow zone drawn, the two marks stay on the first trick and stop at the moment the second trick takes the board, and the same two offsets apply to each trick from its own takeoff and its own catch. On a trick with a shorter flight the slow motion keeps at least a tenth of a second.

That was correct and I could not read it. A zone on the first trick with copies on the others, following rules I had to be told, is not something you understand by looking. Custom means one thing everywhere else: slow motion between the two marks. So in Combos it is now exactly that. The marks start on the first trick's flight, as on any trick, and can be dragged anywhere along the whole combo; everything between them plays at a tenth of real speed, landings and the roll between tricks included, and everything outside at real speed. There is one zone and no copies. Ramp is the speed that slows each flight by itself, so the two no longer overlap in what they do. With the second mark two seconds later, Kickflip combo 1 played slow from 0.45 s to 2.63 s in one stretch. The marks are kept apart for Combos: going back to a single trick brings back the marks set there.

One more change to how the two modes begin. Choosing Variations or Combos used to change nothing but the button: the clean run stayed on the timeline and I only found out what I was about to watch after it had started. A view already put its run up before Play, so the modes do the same now. The attempt is loaded at once, stopped at its start, with its length and its markers on the timeline and its tricks, or what was changed, in the panel. The same happens on coming back from a view. The one thing held back is the line that says how it ended: it appears when the run reaches the moment that decides it, the landing, the miss or the break, and then stays. Telling me that the second trick does not land before I have watched it would spoil the attempt.

Two faults came out of that change and of the longer labels. Variations and combos seemed always to start from their second attempt. Picking a trick from the list still moved it on to its next attempt, as it did when every Play was a new one, so a trick whose first attempt had only been put up and never played began at its second. Picking a trick now shows the attempt that trick is at, and only the arrows move on. And while a combo played the picture sometimes jumped in height: the label under the timeline now names the trick as well as the phase, and on a narrow timeline it wrapped onto a second line, which made the controls taller and the picture shorter for as long as that label lasted. It stays on one line and is cut short where there is no room.

When a deck broke in a combo I saw only a slight move after the break, and thought the slide we had built, the one that depends on the speed, had gone missing. It had not. In the combo I was looking at, the board was down to 1.38 m/s by its third trick and slid 16 cm in 0.30 s after the break; in the Broken Deck view the Heelflip breaks at 1.72 m/s and slides 30 cm in 0.41 s. What hid it was the camera. In Combos it keeps the board in the middle of the picture, so the slide showed as the floor shifting a little under a board that stayed put. The Combos camera now stops at the break, over a few centimetres and not dead, and the broken board is seen to slide on and come to rest. The simulation was not touched.

The recording was made again, for two reasons. Combos were not in it, and it had a mistake I spotted: an Ollie breaking its deck under a caption that said it does not land. The caption was written for Ollie 1. The recorder had counted its presses of the arrow from where the shot before had left the count, and so showed Ollie 4, which breaks. The recorder now reads the number of the attempt on screen and steps until it is the one wanted, and the captions of variation and combo shots take how the run ends from the simulation itself, so a caption can no longer disagree with the picture. The two Ollie variations are gone from the sequence. In their place are two combos at real speed: 360 Flip, combo 3, which is 360 Flip, Backside 180 Kickflip and Backside Bigspin and all three land; and Backside 180 Ollie, combo 5, which is Backside 180 Ollie, Backside 180 Kickflip and Ollie, where the deck breaks on the third. The new recording is ten shots and 42.6 seconds. The hosted video is the earlier take until it is replaced.

The last addition of the day is a way to see that recording without leaving the page. Beside the title there is a link, Features video. It opens the hosted recording in a dialog over the page, with the browser's own player and a Close button; Escape or a click outside closes it too. Opening it stops the run that is playing, and since the page draws only when something changes, nothing is drawn or simulated behind the video while it is open. The page's keys are ignored until it is closed. I had taken the links out of the app the day before because I wanted people to stay with the board; this one keeps them there. A second link beside it, Process notes, is the one that does lead away: it opens this account as published on LinkedIn in a new tab, for anyone who wants the long version in a form that is easier to read than a Markdown file.

I have seen stills of these and the page's own lines under them. I have not judged a combo in motion yet, and that is where the joins between tricks, the reversed board and the camera will have to be judged.

## Technical notes and references (original published build)

The implementation details below describe the original build through 17 November 2026. The changes made on 18 and 19 November, including the revised trick lineup, contact behaviour, Variations and interface controls, are documented in the dated chapters above.

- **Rendering:** Three.js, with a procedural skateboard model, materials, deck graphic, world-space floor and independently adjustable camera. The deck graphic reuses and adapts artwork from Less Rain’s 2017 *Deckheads* skateboard customization project, which is no longer online.
- **Motion:** custom rigid-body simulation with estimated mass/inertia, simplified wheel and deck contacts, external rider inputs, and recorded trajectories for deterministic scrubbing.
- **Playback:** fixed speeds (1×, ¼×, ⅒×), Ramp and Custom. Ramp slows the pop slightly (0.4×), shows the flight in deep slow motion (0.09×), gathers pace over the last 0.1 s of the flight and is back at real speed at the catch, where it stays through the landing or a break. Until 17 November 2026 it climbed back from the catch until 0.09 s after it, so the fall was shown at 2.2 to 2.6 times its real length on every trick, and a breaking run slowed a second time for the break. Custom is Ramp with the slow motion placed by two marks dragged on the timeline, labelled ⅒× and 1×: real speed up to the first (the pop is not slowed), exactly 0.1× from it, and real speed from the second, with the same 0.1 s of gathering pace before it. The marks are kept as offsets from the takeoff and the catch, so they carry over between tricks; they move in 5 ms steps, cannot come closer than 0.12 s, and go back on a double-click. A pair set on a trick with a long flight could cross on one with a short flight, and the run then played at 1× throughout; the first mark now gives way. Custom is not offered below 760 px. Playback ends with the board rolling on while the picture fades.
- **Clean runs:** up to three stored runs per trick (normal, higher and lower jump), cycled in a fixed order, with correspondingly different landings: back wheels first, flat and front wheels first. That tilt along the travel now builds steadily from the catch until touchdown, reaching about 3.5° on the normal jump, and each run also has a sideways lean of its own, between 0° and 3.4° (five runs are level). The lean's direction follows the way that run's deck leans after landing in the simulation; its size is set by hand. All 32 reference solutions remain the successful baseline, and their flights are unchanged up to the catch. No board is now motionless for more than 11 ms before landing; on five higher jumps it had been 45–65 ms.
- **Trucks:** from ground contact, each hanger (with its axle and wheels) turns about the pivot line through the pivot cup and the yoke, held by a bushing with stiffness, damping and a travel stop. Wheel contact points and grip direction turn with it, so a leaning deck steers. The bushings are drawn shearing with the hanger. In free flight the trucks are rigid.
- **Rider’s sideways balance:** independent sideways position and speed; legs that give between feet and mass; feet planted on the deck from touchdown; weight applied under the rider’s mass; slow, limited pressure shift after a reaction time.
- **Deck flex:** visual deformation based on individual foot forces and longitudinal contact positions in a simplified beam between the truck mounts. The mounting areas stay fixed under the bolted baseplates. A 20 ms response filters the calculated load. The span is bent no harder than the less loaded truck pushes back, so a board with one truck still in the air turns about the other and does not bend. It is now drawn at its calculated size (1×): about 0.6–1 mm on near-bolt clean landings, and roughly 3–9 mm on some off-bolt variations. The bending does not feed back into rigid-body motion; wood stiffness, support conditions and deck shape are approximations.
- **Views:** five presets, in this order: Orbit View, Top View, Truck Response, Deck Flex and Broken Deck. Until 17 November 2026 the first two were Flip mechanics and Rotation and catch, and the other three had a lowercase second word. Each owns its run, starting point, camera and allowed speeds. Orbit View and Top View start in Ramp (also allow Custom and ¼×); Truck Response and Deck Flex start at ⅒× (also allow ¼×); Broken Deck starts at Custom, with the ⅒× mark 0.03 s later and the 1× mark 0.05 s earlier than they otherwise stand (also allows Ramp, ¼×, ⅒× and 1×; on a narrow screen it starts in Ramp). Leaving the view puts the marks back where they were. Orbit View and Broken Deck share one camera, which travels round behind the board while it is in the air; Top View looks from above the front quarter. Deck Flex chooses the strongest surviving non-middle-foot variation among the first twenty for a trick; Broken Deck puts both feet at the middle and raises the leg stiffness until the run breaks, starting with Double Kickflip; since the breaking point was lowered this happens at ordinary stiffness, on all twelve tricks. Views wait for Play, preserve the view while changing tricks, and restore the previous mode and speed when leaving via Reset View or Reset. Other speeds, mode selection and Strobe are unavailable inside a view.
- **Loading:** the compact build of Three.js, preloaded together with the project's own modules so the downloads run in parallel. The first trick is still simulated before the first frame is drawn.
- **Optimization:** stored per-trick burst inputs (32 successful runs), cached trajectories, and analytic continuation of steady rollout. Clean-run stored inputs are checked before use. Variations perturb a stored burst and simulate once without re-solving or guaranteeing a landing; the recorded attempt remains deterministic.
- **Known approximations:** target-driven solving for clean catches, limited upward holding forces from invisible feet, grip at low normal load, both feet catching together in clean runs, cleaner torque fallback for the 360 Flip and Hardflip, simplified Impossible, no lower-jump run for 360 Flip, Hardflip, Inward Heelflip and Impossible, incomplete rider biomechanics, approximate flex and fixed contact-plane behaviour. Ordinary foot placements in Variations are chosen within 80 mm inward of the near-bolt stance; exceptional feet-together cases are near the centre, never farther outward toward the nose or tail. The current model still tends to square the board rapidly after a clean catch. The break threshold, residual load and post-break contact are engineering approximations, not a validated structural model. The sideways landing lean is a rider input chosen by hand for each run; only its direction is taken from the simulation. The deck is drawn bending along its length only, without the slight twist a real deck has.
- **Variations:** Clean Run / Variations in the playback controls, N to toggle. Input bounds remain flick ±6%, scoop ±5%, foot-return timing ±16 ms and Impossible’s hooked push ±16%. Most runs use independent foot positions up to 80 mm inward, weighted toward the bolts. In about one attempt in twenty the feet arrive together at the middle, 170–200 mm in from the trucks, always with increased leg stiffness, from 1.6× up to 3.5×. (At first a quarter of attempts brought the feet together, most with ordinary legs; one variation in ten then bowed the deck by 10–23 mm and sprang back.) Four displayed outcomes are landed, landed badly (the chosen 3 mm flex threshold), not landed and deck breaks. A board rolling away without the rider does not count as a landing. In Claude’s first 60 variations of all twelve tricks, about 31% landed cleanly, 30% roughly, 35% missed and 4% broke (223, 214, 254 and 29 of 720); every trick breaks at least once in those 60, and no surviving landing bends more than 10 mm. These are model outputs rather than measured probabilities. The inputs depend on trick and attempt number; runs replay and scrub deterministically.
- **Interface additions:** Tricks under the title and Views at lower right; collapsible side lists and trick description on desktop, native selectors on small screens, responsive playback groups, and a short message when changing mode. The description initially collapses at 761–1000 px rather than disappearing. The page opens still, and the sliding lists intentionally do not follow the operating system's reduced-motion preference. Inside a view, incompatible speed controls, the Clean Run / Variations switch and Strobe are disabled until Reset View or Reset. Names, buttons and status words are written with every word capitalised (Clean Run, Reset View, Deck Broken, Did Not Land); sentences are written as sentences. The trick's name is sized between the title and the list and sits level with the Tricks heading; its description is a size smaller with more open lines. The arrows beside the headings are drawn as two lines, set on the middle of the small letters.
- **Breaking deck:** the approximate beam model now uses an assumed bending strength of 60 MPa, giving a central breaking deflection near 16 mm for this deck. It was 100 MPa and about 27 mm at first (Claude explored 80–120 MPa for clear maple); the lower figure is a judgement by eye, argued from the bolt holes and glue lines, not a measurement. The trigger comes from the calculated load and bend at true display scale. A 6 kg effective post-break mass and a wood-ground friction coefficient of 0.4 are also estimates. That friction slows the rider and the board together as one mass, since soles grip the deck harder than broken wood grips the floor; the board comes to rest within about 20 cm. The middle is driven toward the ground by the remaining simulated leg load, and on a deck that breaks while leaning on its trucks it stops when its lower edge reaches the floor; the joined grip tape, V-fold, stepped seven-ply crack, exposed wood and folding shadow are drawn. The rider is assumed to stay on the broken board, and wheel forces are not fully re-solved for two independent halves. The simulation is not a physical model of splinter propagation.
- **Video recording:** the recorder plays a fixed nine-shot sequence of about 38 seconds on the real page: Orbit View in Ramp; a Kickflip at the Custom speed, slowed to a stop in the air while the camera goes once round the board; a 360 Flip in Ramp with Strobe on, while the camera turns part of the way round; Truck Response and Deck Flex at ⅒×; two variations that do not land; and the Broken Deck view as it opens, at Custom, and again at ⅒×. The circling shot sets the timeline itself every frame and moves the camera with the page's own drag and wheel. The hosted MP4 is still the recording of 16 November (three views, three variations and the broken deck at 1× and ⅒×), made before Ramp's timing, the Custom speed and the view names changed, until it is replaced.
- **Catch-to-touchdown investigation:** Claude’s scratch comparisons checked 60 fps sampling, Ramp timing, leg-extension control, later catches, relaxed catch constraints and an evolving sole plane. These experiments were not merged. Their results exposed approximation limits, including rapid stabilization and an almost common catch target. Numerical successes and visual plausibility were evaluated separately. A later round on the same question tried a later, gradual catch on the Pop Shuvit, which shortened the idle fall by about a third and was not merged, and then merged two rider inputs: a landing tilt that builds until touchdown and a small sideways lean per run.
- **Visual reference:** [Skateology kickflip slow motion](https://www.youtube.com/watch?v=wfCgCXvw50A).
- **Physics reference:** [The Physics of Skateboarding](https://www.real-world-physics-problems.com/physics-of-skateboarding.html), especially the ollie force diagrams.
- **Engineering research:** Nakashima and Chida, [Simulation study to elucidate the mechanism of ollie jump in skateboarding](https://doi.org/10.1299/mej.21-00230) (2021), using measured rider foot motion.
- **Engineering research:** Heinen and colleagues, [Maximizing ollie height by optimizing control strategy and skateboard geometry using direct collocation](https://doi.org/10.1007/s12283-023-00448-y) (2024), a simplified human-board optimization model.
- **Deck construction references:** [skatedeluxe skateboard decks wiki](https://www.skatedeluxe.com/blog/en/wiki/skateboarding/skateboard-wiki/decks/) and [Fillow’s guide to deck technology and materials](https://fillow.net/en/guides/skateboard-deck-technology-materials), for construction and landing-position context rather than measured stiffness.
- **Background reading:** [The Physics Behind Skateboard Tricks](https://www.mysimulator.uk/articles/the-physics-behind-skateboard-tricks-potential-energy-kinetic-energy-a/), mainly relevant to broad energy and friction principles rather than a detailed flatground model.

*These notes record an iterative creative-coding process, including reported tests and subjective visual observations. They are not a claim of scientific validation or a controlled benchmark of AI models.*
